/**
 * Sync endpoint : reçoit les données d'un salon depuis Helsinki au moment où
 * le coiffeur passe LIVE (post-paiement). Active uniquement en mode TENANT_ONLY.
 *
 * Auth : bearer token partagé (env SYNC_BEARER_TOKEN), MUST match côté Helsinki
 * provisioning-worker pour que le POST soit accepté.
 *
 * POST /api/sync/:slug
 * Body : { row: { ...colonnes salons } }
 *   → INSERT OR REPLACE INTO salons
 *
 * DELETE /api/sync/:slug
 *   → DELETE FROM salons (utile si annulation d'abonnement post-grace period)
 */

import express from 'express';
import db from '../db.js';

const router = express.Router();

const SYNC_TOKEN = process.env.SYNC_BEARER_TOKEN || '';

function requireSyncAuth(req, res, next) {
  if (!SYNC_TOKEN) {
    return res.status(500).json({ error: 'SYNC_BEARER_TOKEN non configuré côté Falkenstein' });
  }
  const auth = req.headers.authorization || '';
  const got = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (got !== SYNC_TOKEN) return res.status(403).json({ error: 'Token sync invalide' });
  next();
}

router.post('/sync/:slug', express.json({ limit: '2mb' }), requireSyncAuth, (req, res) => {
  const { slug } = req.params;
  const row = req.body?.row;
  if (!row || row.slug !== slug) {
    return res.status(400).json({ error: 'row.slug doit matcher :slug' });
  }

  // Liste des colonnes acceptées (= toutes celles de la table salons sauf id auto)
  const allowed = [
    'slug', 'nom', 'nom_clean', 'nom_clean_at',
    'ville', 'code_postal', 'adresse', 'telephone', 'email',
    'latitude', 'longitude', 'note_avis', 'nb_avis',
    'meta_description', 'meta_image',
    'lien_facebook', 'lien_instagram', 'lien_tiktok', 'lien_youtube', 'lien_google_maps',
    'overrides_json', 'data_json',
    'screenshot_path', 'screenshot_generated_at',
    'csv_source', 'group_id',
    'edit_token',
    'owner_email', 'plan',
    'stripe_customer_id', 'stripe_subscription_id',
    'commitment_months', 'commitment_until',
    'subscription_status', 'live_hostname', 'cloudflare_hostname_id',
    'signup_session_id', 'signed_up_at', 'cancelled_at',
    'domain_suggestions_json', 'domain_suggestions_at',
    'created_at', 'updated_at',
  ];

  const cols = allowed.filter(c => row[c] !== undefined);
  const placeholders = cols.map(c => '@' + c).join(',');
  const colNames = cols.join(',');

  // INSERT OR REPLACE : crée ou écrase l'entrée existante avec ce slug
  const sql = `INSERT OR REPLACE INTO salons (${colNames}) VALUES (${placeholders})`;
  const params = {};
  for (const c of cols) params[c] = row[c] === undefined ? null : row[c];

  try {
    db.prepare(sql).run(params);
    res.json({ ok: true, slug, action: 'upserted' });
  } catch (err) {
    console.error('[sync POST]', err);
    res.status(500).json({ error: 'DB error: ' + err.message });
  }
});

router.delete('/sync/:slug', requireSyncAuth, (req, res) => {
  const { slug } = req.params;
  try {
    const result = db.prepare('DELETE FROM salons WHERE slug = ?').run(slug);
    res.json({ ok: true, slug, deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
