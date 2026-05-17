/**
 * Cookie session pour l'admin coiffeur sur les sites LIVE (Falkenstein).
 *
 * Architecture :
 *   - Première ouverture : lien email avec `?token={edit_token}` arrive
 *   - Server vérifie edit_token contre DB → pose un cookie HMAC-signé
 *     `mqs_session={base64(payload)}.{hmac}` (HTTPOnly, Secure, SameSite=Lax)
 *   - Redirect 302 vers /admin/{slug} (URL nettoyée, token n'apparaît plus)
 *   - Accès suivant : cookie envoyé → vérifie signature + expiry + slug → 200
 *   - Si cookie expiré OU absent ET pas de token URL → 401 + form magic link
 *
 * Le cookie est STATELESS (signed token, pas de DB lookup). Trade-off :
 * - + Pas de DB lookup à chaque requête
 * - - Pas de révocation individuelle (rotation SESSION_SECRET = logout global)
 *
 * Pour V1 c'est acceptable. V2 : DB-backed sessions si on veut revoke.
 */

import crypto from 'node:crypto';

const COOKIE_NAME = 'mqs_session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET manquant ou < 16 chars');
  }
  return s;
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

/**
 * Génère un cookie session signé.
 * @param {string} slug
 * @returns {string} valeur cookie
 */
export function buildSessionCookie(slug) {
  const payload = { slug, exp: Date.now() + COOKIE_MAX_AGE_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Vérifie un cookie session. Retourne le slug si valide, sinon null.
 * @param {string} cookieValue
 * @returns {string|null}
 */
export function verifySessionCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  // Constant-time comparaison de signatures
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.slug || typeof payload.slug !== 'string') return null;
    if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload.slug;
  } catch {
    return null;
  }
}

/**
 * Helper Express : pose le cookie session sur la réponse.
 */
export function setSessionCookie(res, slug) {
  const value = buildSessionCookie(slug);
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

/**
 * Helper Express : retire le cookie session (logout).
 */
export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Helper Express : lit + vérifie le cookie session. Retourne le slug ou null.
 */
export function readSessionCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';').map(s => s.trim());
  for (const p of pairs) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const name = p.slice(0, eq).trim();
    if (name === COOKIE_NAME) {
      const value = p.slice(eq + 1).trim();
      return verifySessionCookie(value);
    }
  }
  return null;
}

export const COOKIE_NAME_EXPORT = COOKIE_NAME;
