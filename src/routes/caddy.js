/**
 * Caddy on-demand TLS — endpoint "ask"
 *
 * Caddy interroge cet endpoint avant de demander un cert Let's Encrypt pour un
 * nouveau hostname. On retourne :
 *   200 OK  → Caddy provisionne le cert (hostname autorisé)
 *   4xx     → Caddy refuse (hostname inconnu/non actif/banni)
 *
 * On accepte :
 *   - customers.monsitehq.com (= notre fallback FQDN historique)
 *   - n'importe quel hostname présent en DB avec subscription_status in (live, active, trialing)
 *
 * Sécurité :
 *   - Lecture seule (pas de modif)
 *   - Pas d'auth (Caddy ne peut pas s'authentifier sur l'ask endpoint)
 *   - Validation stricte pour ne pas hit le rate-limit Let's Encrypt sur des
 *     hostnames pirates pointés sur notre IP.
 *
 * Doc Caddy : https://caddyserver.com/docs/automatic-https#on-demand-tls
 */

import express from 'express';
import db from '../db.js';

const router = express.Router();

// Hostnames de notre infra acceptés en plus de la DB salons
// (= les FQDNs propres de Falkenstein, vu qu'on ne les a pas en table salons)
const INFRA_HOSTNAMES = new Set([
  'customers.monsitehq.com',
  'customers.maquickpage.fr', // futur, si on migre
]);

// État de subscription qui autorise la délivrance du cert SSL
const ACTIVE_STATUSES = new Set(['live', 'active', 'trialing']);

router.get('/check-hostname', (req, res) => {
  const domain = (req.query.domain || '').toString().toLowerCase().trim();

  // Validation basique du format
  if (!domain || domain.length > 253 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return res.status(400).send('invalid');
  }

  // Hostname infra (toujours autorisé)
  if (INFRA_HOSTNAMES.has(domain)) {
    return res.status(200).send('ok');
  }

  // Lookup en DB par live_hostname
  let salon;
  try {
    salon = db.prepare(`
      SELECT slug, subscription_status, live_hostname
      FROM salons
      WHERE live_hostname = ?
      LIMIT 1
    `).get(domain);
  } catch (err) {
    console.error('[caddy/check-hostname] DB error:', err.message);
    return res.status(500).send('db_error');
  }

  if (!salon) {
    // Pas de salon avec ce hostname → refuse (Caddy ne provisionnera pas de cert)
    console.log(`[caddy/check-hostname] ${domain} → 404 (no salon)`);
    return res.status(404).send('unknown_hostname');
  }

  if (!ACTIVE_STATUSES.has(salon.subscription_status)) {
    console.log(`[caddy/check-hostname] ${domain} → 403 (status=${salon.subscription_status})`);
    return res.status(403).send('inactive_subscription');
  }

  // OK : Caddy peut provisionner le cert pour ce hostname
  console.log(`[caddy/check-hostname] ${domain} → 200 (slug=${salon.slug})`);
  return res.status(200).send('ok');
});

export default router;
