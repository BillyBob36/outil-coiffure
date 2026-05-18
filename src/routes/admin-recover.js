/**
 * Magic link recovery pour les sites LIVE (Falkenstein).
 *
 * Flow :
 *   - Coiffeur arrive sur /admin/{slug} sans cookie ni token → la page UI 401
 *     affiche un form "Saisissez votre email" qui POST /api/auth/request-magic-link
 *   - POST /api/auth/request-magic-link → vérifie email == owner_email du salon →
 *     génère token éphémère 10 min stocké en DB → envoie email Resend
 *   - Coiffeur clique le lien : GET /admin/{slug}?session_token={one-time}
 *     → server vérifie le token contre DB → pose cookie + redirect URL clean
 *
 * Pour des raisons de UX, on accepte aussi sur la page recover du Falkenstein
 * (= /recover-admin) qui prend slug + email implicitement (= depuis URL host).
 */

import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { sendRaw } from '../email-sender.js';

const router = express.Router();

// Rate limit en mémoire (5/h par IP)
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map();
function canAttempt(key) {
  const now = Date.now();
  const past = (attempts.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (past.length >= RATE_MAX) { attempts.set(key, past); return false; }
  past.push(now);
  attempts.set(key, past);
  return true;
}

function isValidEmail(s) {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * POST /api/auth/request-magic-link
 * Body: { email }
 *
 * Le slug est déduit du host header (= live_hostname → salon row).
 * On envoie un magic link à l'email SI ET SEULEMENT SI l'email correspond
 * à owner_email du salon associé à ce hostname.
 *
 * Réponse uniforme côté front (anti-enumeration).
 */
router.post('/auth/request-magic-link', express.json({ limit: '1kb' }), async (req, res) => {
  const ip = (req.ip || '').toString().split(',')[0].trim();
  if (!canAttempt(ip || 'no-ip')) {
    return res.status(429).json({ ok: true, message: 'Si l\'email correspond, vous recevrez un lien dans quelques minutes.' });
  }

  const email = (req.body?.email || '').toString().trim().toLowerCase();
  if (!isValidEmail(email)) {
    // Réponse uniforme volontairement (anti-enumeration)
    return res.json({ ok: true, message: 'Si l\'email correspond, vous recevrez un lien dans quelques minutes.' });
  }

  const host = (req.hostname || '').toLowerCase();
  let salon;
  try {
    salon = db.prepare(`
      SELECT slug, owner_email, edit_token, nom_clean, nom, live_hostname
      FROM salons
      WHERE live_hostname = ? AND subscription_status IN ('live', 'active', 'trialing')
      LIMIT 1
    `).get(host);
  } catch (err) {
    console.error('[admin-recover] DB error:', err.message);
    return res.json({ ok: true });
  }

  if (!salon) {
    console.log(`[admin-recover] no live salon for host=${host}, email=${email}`);
    return res.json({ ok: true, message: 'Si l\'email correspond, vous recevrez un lien dans quelques minutes.' });
  }

  if ((salon.owner_email || '').toLowerCase() !== email) {
    console.log(`[admin-recover] email mismatch for slug=${salon.slug} (got ${email})`);
    return res.json({ ok: true, message: 'Si l\'email correspond, vous recevrez un lien dans quelques minutes.' });
  }

  // Génère un token éphémère stocké en DB (10 min)
  const sessionToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
  try {
    db.prepare(`
      UPDATE salons
      SET recovery_token=?, recovery_token_expires_at=?, updated_at=datetime('now')
      WHERE slug=?
    `).run(sessionToken, expiresAt, salon.slug);
  } catch (err) {
    console.error('[admin-recover] failed to store recovery_token:', err.message);
    return res.json({ ok: true });
  }

  // Envoie l'email
  const adminUrl = `https://${host}/admin/${encodeURIComponent(salon.slug)}?session_token=${encodeURIComponent(sessionToken)}`;
  const salonName = salon.nom_clean || salon.nom || 'votre salon';
  try {
    await sendRaw({
      to: email,
      subject: `${salonName} — lien de connexion à votre espace`,
      html: `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"></head><body style="font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:30px;color:#15130E;background:#fff;line-height:1.55;font-size:15px;">
        <h2 style="font-size:20px;margin:0 0 16px;">Bonjour,</h2>
        <p>Vous avez demandé à vous connecter à l'espace de modification de votre site <strong>${salonName}</strong>.</p>
        <p>Cliquez sur le bouton ci-dessous pour vous connecter automatiquement&nbsp;:</p>
        <p style="margin:28px 0;text-align:center;">
          <a href="${adminUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">Accéder à mon espace →</a>
        </p>
        <p style="font-size:13px;color:#6b7280;">
          Ce lien est valable <strong>10 minutes</strong> et ne peut être utilisé qu'une seule fois.
          Si vous n'avez pas demandé ce mail, ignorez-le.
        </p>
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="font-size:12px;color:#9ca3af;margin:0;">MaQuickPage — contact@maquickpage.fr</p>
      </body></html>`,
      text: `Bonjour,\n\nVous avez demandé à vous connecter à l'espace de modification de ${salonName}.\n\nCliquez ce lien pour vous connecter (valable 10 minutes) :\n${adminUrl}\n\nSi vous n'avez pas demandé ce mail, ignorez-le.\n\nMaQuickPage — contact@maquickpage.fr`,
    });
    console.log(`[admin-recover] magic link envoyé à ${email} pour slug=${salon.slug}`);
  } catch (err) {
    console.error('[admin-recover] email send failed:', err.message);
  }

  res.json({ ok: true, message: 'Si l\'email correspond, vous recevrez un lien dans quelques minutes.' });
});

/**
 * Génère un token unique signé en base, single-use, avec TTL paramétrable.
 * Utilisé pour :
 *  - Setup link post-paiement (TTL 24h, envoyé dans l'email "site en ligne")
 *  - Magic link de récupération (TTL 10 min, envoyé via /api/auth/request-magic-link)
 *
 * Retourne le token (string) qui doit être inclus dans l'URL d'accès admin :
 *   https://{liveHostname}/admin/{slug}?token={returnedToken}
 *
 * Le token est consommé lors du 1er clic (cf. consumeSessionToken).
 */
export function generateRecoveryToken(slug, ttlMinutes) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    UPDATE salons
    SET recovery_token=?, recovery_token_expires_at=?, updated_at=datetime('now')
    WHERE slug=?
  `).run(token, expiresAt, slug);
  return token;
}

/**
 * Helper : vérifie un session_token et retourne le slug si valide.
 * Single-use : on supprime le token de la DB après usage.
 */
export function consumeSessionToken(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  let salon;
  try {
    salon = db.prepare(`
      SELECT slug, recovery_token_expires_at
      FROM salons
      WHERE recovery_token = ?
      LIMIT 1
    `).get(token);
  } catch (err) {
    return null;
  }
  if (!salon) return null;
  if (!salon.recovery_token_expires_at) return null;
  const expMs = Date.parse(salon.recovery_token_expires_at + 'Z') || Date.parse(salon.recovery_token_expires_at);
  if (!expMs || expMs < Date.now()) return null;

  // Single-use : on retire le token
  try {
    db.prepare(`
      UPDATE salons
      SET recovery_token=NULL, recovery_token_expires_at=NULL, updated_at=datetime('now')
      WHERE slug=?
    `).run(salon.slug);
  } catch {}
  return salon.slug;
}

export default router;
