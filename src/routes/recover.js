/**
 * Route de récupération d'accès admin (magic link).
 *
 * Flow :
 *   1. Coiffeur va sur monsitehq.com/recover (page HTML statique)
 *   2. Saisit son email → POST /api/recover { email }
 *   3. Si un salon LIVE existe avec cet owner_email :
 *        - on génère un recovery_token UUID (single-use, 10 min)
 *        - on stocke en DB (recovery_token + recovery_token_expires_at)
 *        - on envoie un email Resend avec lien /recover/confirm?token=xxx
 *   4. Si pas trouvé : on renvoie 200 quand même (anti-énumération)
 *   5. Coiffeur clique le lien → GET /recover/confirm?token=xxx
 *        - lookup du salon par recovery_token (non expiré)
 *        - on consume le token (set NULL pour single-use)
 *        - redirect 302 vers https://{live_hostname}/admin/{slug}?token={edit_token}
 *
 * Sécurité :
 *   - Rate-limit en mémoire : max 3 tentatives par email par heure
 *   - Token UUID 128 bits, single-use, expiration courte
 *   - Anti-énumération : réponse identique que l'email existe ou pas
 */

import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { sendRecoveryEmail } from '../email-sender.js';

const router = express.Router();

// Rate-limit en mémoire : map email → array de timestamps des dernières tentatives.
// Auto-purge des entrées > 1h pour éviter croissance infinie.
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1h
const rateAttempts = new Map();

function canAttempt(email) {
  const now = Date.now();
  const key = (email || '').trim().toLowerCase();
  if (!key) return false;
  const past = rateAttempts.get(key) || [];
  const recent = past.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  rateAttempts.set(key, recent);
  // Hygiène : purge des emails inactifs (~ tous les 50 calls)
  if (rateAttempts.size > 1000 && Math.random() < 0.02) {
    for (const [k, ts] of rateAttempts) {
      const stillRecent = ts.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
      if (stillRecent.length === 0) rateAttempts.delete(k);
      else rateAttempts.set(k, stillRecent);
    }
  }
  return true;
}

function isValidEmail(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// =============================================================================
// POST /api/recover
// Body: { email }
// Réponse standard 200 quel que soit le résultat (anti-énumération)
// (router monté sur '/', donc on déclare des paths absolus)
// =============================================================================
router.post('/api/recover', express.json(), async (req, res) => {
  const rawEmail = (req.body?.email || '').trim().toLowerCase();
  // Réponse "neutre" qu'on renvoie dans tous les cas non-erreur explicite
  const neutralOk = { ok: true, message: 'Si cet email correspond à un compte actif, un lien de récupération vient d\'être envoyé.' };

  if (!isValidEmail(rawEmail)) {
    return res.status(400).json({ ok: false, error: 'Adresse e-mail invalide.' });
  }
  if (!canAttempt(rawEmail)) {
    // Rate-limit : on renvoie quand même 200 neutre pour pas révéler que c'est ratelimité par email
    console.warn(`[recover] rate-limit hit for ${rawEmail}`);
    return res.json(neutralOk);
  }

  try {
    // Cherche un salon LIVE/active/trialing avec cet email
    const row = db.prepare(`
      SELECT id, slug, nom_clean, nom, owner_email, edit_token, live_hostname, subscription_status
      FROM salons
      WHERE LOWER(owner_email) = ? AND subscription_status IN ('live', 'active', 'trialing')
      ORDER BY id DESC LIMIT 1
    `).get(rawEmail);

    if (!row || !row.live_hostname) {
      // Aucun compte trouvé → on log mais on renvoie 200 neutre (anti-énumération)
      console.log(`[recover] no active salon for email=${rawEmail}`);
      return res.json(neutralOk);
    }

    // Génère un token UUID single-use, expire dans 10 min
    const token = randomUUID().replace(/-/g, '');
    db.prepare(`
      UPDATE salons
      SET recovery_token = ?,
          recovery_token_expires_at = datetime('now', '+10 minutes'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(token, row.id);

    // Envoie l'email
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://monsitehq.com';
    const confirmUrl = `${baseUrl}/recover/confirm?token=${encodeURIComponent(token)}`;

    const emailResult = await sendRecoveryEmail({
      to: row.owner_email,
      salonName: row.nom_clean || row.nom || null,
      recoverConfirmUrl: confirmUrl,
    });
    if (!emailResult.ok) {
      console.error(`[recover] email send failed for ${rawEmail}:`, emailResult.reason);
      // On renvoie quand même 200 neutre pour ne pas signaler aux attaquants quelles
      // adresses sont en base (l'envoi a peut-être échoué pour raison technique).
    } else {
      console.log(`[recover] sent recovery email to ${rawEmail} for slug=${row.slug}`);
    }

    res.json(neutralOk);
  } catch (err) {
    console.error('[recover] unexpected error:', err);
    // Erreur 500 mais message neutre
    res.status(500).json({ ok: false, error: 'Une erreur est survenue. Réessayez dans quelques minutes.' });
  }
});

// =============================================================================
// GET /recover/confirm?token=xxx
// Consume le token et redirige vers l'admin du coiffeur avec son edit_token
// =============================================================================
router.get('/recover/confirm', (req, res) => {
  const token = (req.query.token || '').toString();
  if (!token || !/^[a-f0-9]{32}$/i.test(token)) {
    return res.status(400).send(renderErrorPage(
      'Lien invalide',
      'Ce lien de récupération n\'est pas valide. Veuillez en demander un nouveau.'
    ));
  }

  try {
    const row = db.prepare(`
      SELECT id, slug, edit_token, live_hostname, recovery_token_expires_at
      FROM salons
      WHERE recovery_token = ?
        AND recovery_token_expires_at IS NOT NULL
        AND datetime(recovery_token_expires_at) > datetime('now')
        AND subscription_status IN ('live', 'active', 'trialing')
      LIMIT 1
    `).get(token);

    if (!row || !row.edit_token || !row.live_hostname) {
      return res.status(410).send(renderErrorPage(
        'Lien expiré ou invalide',
        'Ce lien de récupération a expiré (validité de 10 minutes) ou n\'est plus valide. Demandez un nouveau lien depuis la page <a href="/recover">/recover</a>.'
      ));
    }

    // Consume le token (single-use)
    db.prepare(`
      UPDATE salons
      SET recovery_token = NULL,
          recovery_token_expires_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(row.id);

    // Redirige vers le custom hostname avec le edit_token
    const target = `https://${row.live_hostname}/admin/${encodeURIComponent(row.slug)}?token=${encodeURIComponent(row.edit_token)}`;
    console.log(`[recover] confirmed token for slug=${row.slug} → redirect to admin`);
    res.redirect(302, target);
  } catch (err) {
    console.error('[recover/confirm] error:', err);
    res.status(500).send(renderErrorPage(
      'Erreur',
      'Une erreur est survenue. Réessayez dans quelques minutes ou contactez contact@monsitehq.com.'
    ));
  }
});

function renderErrorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — MONSITEHQ</title>
<link rel="stylesheet" href="/legal/legal.css">
</head>
<body>
<main>
<header class="legal-header">
  <h1>${escapeHtml(title)}</h1>
</header>
<p>${message}</p>
<p style="margin-top: 32px;">
  <a href="/recover" style="display: inline-block; background: #0a0a0a; color: white; padding: 12px 28px; text-decoration: none; border-radius: 999px; font-weight: 600;">Demander un nouveau lien →</a>
</p>
</main>
</body></html>`;
}

function escapeHtml(s) {
  return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export default router;
