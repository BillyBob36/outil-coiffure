/**
 * Outil de démo individuel — module ISOLÉ (Volet B).
 *
 * Servi uniquement sur le hostname demo.maquickpage.fr (cf. server.js).
 * Protégé par une URL secrète : tout doit passer par /{DEMO_TOOL_SECRET}/...
 * Sans le bon secret → 404 (l'outil est invisible).
 *
 * Ne touche à RIEN d'autre dans l'app. Lit la même DB (lecture seule sur salons,
 * + envoi email via Resend). Aucune écriture salon.
 *
 * Endpoints (tous sous /{secret}) :
 *   GET  /{secret}            → page mobile (HTML statique)
 *   GET  /{secret}/api/search?q=...        → recherche par ville OU nom
 *   POST /{secret}/api/send-email {slug,email} → envoie la démo par mail
 */

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import db from '../db.js';
import { sendRaw } from '../email-sender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const SECRET = process.env.DEMO_TOOL_SECRET || '';
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://maquickpage.fr').replace(/\/$/, '');
const DEMO_INDEX = join(__dirname, '..', '..', 'public', 'demo', 'index.html');

// === Rate limit basique (anti-abus si l'URL secrète fuite) : 40 envois / h / IP ===
const RATE_MAX = 40;
const RATE_WINDOW = 60 * 60 * 1000;
const sendAttempts = new Map();
function canSend(ip) {
  const now = Date.now();
  const past = (sendAttempts.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (past.length >= RATE_MAX) { sendAttempts.set(ip, past); return false; }
  past.push(now);
  sendAttempts.set(ip, past);
  return true;
}

function escapeHtml(s) {
  return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function isValidEmail(s) {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function buildLinks(salon) {
  const tk = salon.edit_token ? `?token=${encodeURIComponent(salon.edit_token)}` : '';
  return {
    preview: `${PUBLIC_BASE}/preview/${encodeURIComponent(salon.slug)}${tk}`,
    admin: `${PUBLIC_BASE}/admin/${encodeURIComponent(salon.slug)}${tk}`,
    screenshot: (salon.screenshot_path && salon.screenshot_path.trim())
      ? `${PUBLIC_BASE}${salon.screenshot_path}`
      : null,
  };
}

// === Index normalisé en mémoire (insensible accents / tirets / espaces) ===
// Les noms de villes FR sont pleins de tirets et d'accents (Bar-le-Duc,
// Saint-Étienne…). Sans ça, "bar le duc" ne trouvait pas "Bar-le-Duc".
// On normalise query ET données : minuscule + sans accents + tokens alphanum.
// Cache rafraîchi toutes les 2 min (les imports sont rares).
const DEBURR = { 'à':'a','á':'a','â':'a','ä':'a','ã':'a','å':'a','è':'e','é':'e','ê':'e','ë':'e','ì':'i','í':'i','î':'i','ï':'i','ò':'o','ó':'o','ô':'o','ö':'o','õ':'o','ù':'u','ú':'u','û':'u','ü':'u','ý':'y','ÿ':'y','ñ':'n','ç':'c','œ':'oe','æ':'ae' };
function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/[àáâäãåèéêëìíîïòóôöõùúûüýÿñçœæ]/g, c => DEBURR[c] || c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let salonCache = { rows: null, builtAt: 0 };
const CACHE_TTL = 120 * 1000;
function getSalonIndex() {
  const now = Date.now();
  if (salonCache.rows && (now - salonCache.builtAt) < CACHE_TTL) return salonCache.rows;
  const rows = db.prepare(`
    SELECT slug, nom, nom_clean, ville, code_postal, edit_token, screenshot_path
    FROM salons
  `).all();
  for (const r of rows) {
    const display = (r.nom_clean && r.nom_clean.trim()) || r.nom || '';
    r._hay = normalize(`${display} ${r.nom || ''} ${r.ville || ''} ${r.code_postal || ''}`);
  }
  salonCache = { rows, builtAt: now };
  return rows;
}

// === Gate secret : valide le 1er segment de path ===
router.param('secret', (req, res, next, val) => {
  if (!SECRET) return res.status(503).send('Outil non configuré (DEMO_TOOL_SECRET manquant).');
  if (val !== SECRET) return res.status(404).send('Not found');
  next();
});

// Page mobile
router.get('/:secret', (req, res) => {
  res.sendFile(DEMO_INDEX);
});

// Recherche : par ville OU nom de salon (insensible accents/tirets/espaces).
// Tous les tokens de la requête doivent être présents (AND) dans le haystack
// normalisé du salon (nom + ville + code postal).
router.get('/:secret/api/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (q.length < 2) return res.json({ results: [] });
  const tokens = normalize(q).split(' ').filter(t => t.length >= 2);
  if (tokens.length === 0) return res.json({ results: [] });

  let matched;
  try {
    const idx = getSalonIndex();
    matched = idx.filter(r => tokens.every(t => r._hay.includes(t)));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Tri : ville puis nom
  matched.sort((a, b) => {
    const va = (a.ville || '').toLowerCase(), vb = (b.ville || '').toLowerCase();
    if (va !== vb) return va < vb ? -1 : 1;
    const na = ((a.nom_clean || a.nom) || '').toLowerCase();
    const nb = ((b.nom_clean || b.nom) || '').toLowerCase();
    return na < nb ? -1 : (na > nb ? 1 : 0);
  });

  const total = matched.length;
  const results = matched.slice(0, 60).map(r => {
    const links = buildLinks(r);
    return {
      slug: r.slug,
      nom: (r.nom_clean && r.nom_clean.trim()) || r.nom,
      ville: r.ville || '',
      code_postal: r.code_postal || '',
      preview: links.preview,
      admin: links.admin,
      screenshot: links.screenshot,
    };
  });
  res.json({ results, count: total });
});

// Envoi de la démo par mail
router.post('/:secret/api/send-email', express.json({ limit: '8kb' }), async (req, res) => {
  const ip = (req.ip || '').toString();
  if (!canSend(ip)) return res.status(429).json({ error: 'Trop d\'envois, réessayez plus tard.' });

  const slug = (req.body?.slug || '').toString().trim();
  const email = (req.body?.email || '').toString().trim().toLowerCase();
  if (!slug) return res.status(400).json({ error: 'slug requis' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });

  const salon = db.prepare(`
    SELECT slug, nom, nom_clean, ville, edit_token, screenshot_path
    FROM salons WHERE slug = ?
  `).get(slug);
  if (!salon) return res.status(404).json({ error: 'Salon introuvable' });

  const salonName = (salon.nom_clean && salon.nom_clean.trim()) || salon.nom || 'votre salon';
  const links = buildLinks(salon);
  const subject = `${salonName} — votre site de démonstration est prêt`;

  const screenshotBlock = links.screenshot ? `
    <tr><td style="padding: 0 0 20px;">
      <a href="${links.preview}" style="text-decoration:none;border:0;">
        <img src="${escapeHtml(links.screenshot)}" alt="Aperçu du site ${escapeHtml(salonName)}"
             width="100%" style="display:block;width:100%;max-width:520px;border:1px solid #e5e7eb;border-radius:12px;">
      </a>
    </td></tr>` : '';

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;padding:30px;">
      <tr><td>
        <h1 style="font-size:22px;margin:0 0 16px;">Bonjour,</h1>
        <p style="font-size:16px;line-height:1.5;color:#4b5563;margin:0 0 20px;">
          Nous avons préparé un <strong>site de démonstration</strong> pour <strong>${escapeHtml(salonName)}</strong>${salon.ville ? ` à ${escapeHtml(salon.ville)}` : ''}.
          Vous pouvez le découvrir et le tester librement, c'est gratuit et sans engagement.
        </p>
        ${screenshotBlock}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
          <tr><td>
            <a href="${links.preview}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">Voir mon site →</a>
          </td></tr>
        </table>
        <p style="font-size:14px;line-height:1.5;color:#4b5563;margin:0 0 8px;">
          Vous voulez modifier les textes, photos ou prestations ? C'est très simple :
        </p>
        <p style="margin:0 0 24px;">
          <a href="${links.admin}" style="color:#002FA7;font-weight:600;">Modifier mon site →</a>
        </p>
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">
          MaQuickPage — sites web premium pour coiffeurs.<br>
          Si ce message ne vous concerne pas, ignorez-le simplement.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;

  const text = `Bonjour,

Nous avons préparé un site de démonstration pour ${salonName}${salon.ville ? ` à ${salon.ville}` : ''}.
Gratuit et sans engagement.

Voir mon site : ${links.preview}
Modifier mon site : ${links.admin}

MaQuickPage — sites web premium pour coiffeurs.`;

  try {
    const r = await sendRaw({ to: email, subject, html, text });
    if (!r.ok) return res.status(502).json({ error: 'Envoi échoué' });
    return res.json({ ok: true, to: email });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Catch-all terminal : sur le hostname démo, toute requête non matchée (mauvais
// secret, chemin inconnu) → 404. Évite que la requête "fuie" vers les autres
// routes de l'app (landing/public). Garantit l'isolation totale du module.
router.use((req, res) => res.status(404).send('Not found'));

export default router;
