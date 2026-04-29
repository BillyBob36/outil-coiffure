import express from 'express';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { stringify } from 'csv-stringify/sync';
import { mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import db from '../db.js';
import { importCsvFile } from '../csv-importer.js';
import { captureSalon, captureBatch } from '../screenshot-worker.js';
import { startCleanNames, getCleanJob } from '../name-cleaner.js';

const router = express.Router();
const UPLOAD_DIR = './data/csv-uploads';
const EXPORT_DIR = './data/csv-exports';
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 200 * 1024 * 1024 }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path === '/login' || req.path === '/login.html') return next();
  // Si l'appel est XHR/fetch (Accept: application/json OU Sec-Fetch-Mode: cors), retourner 401 JSON
  const acceptsJson = (req.headers.accept || '').includes('application/json');
  const isXhr = req.xhr || req.headers['sec-fetch-mode'] === 'cors';
  if (acceptsJson || isXhr) {
    return res.status(401).json({ error: 'Non authentifie' });
  }
  if (req.accepts('html')) return res.redirect('/admin/login');
  return res.status(401).json({ error: 'Non authentifie' });
}

router.post('/login', express.json(), express.urlencoded({ extended: true }), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });

  req.session.userId = user.id;
  req.session.email = user.email;
  res.json({ ok: true, email: user.email });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ authenticated: true, email: req.session.email });
  }
  res.json({ authenticated: false });
});

router.use(requireAuth);

router.post('/upload-csv', upload.single('csv'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });

  const sourceName = req.body.source_name || req.file.originalname || basename(req.file.path);
  const groupId = req.body.group_id ? parseInt(req.body.group_id, 10) || null : null;
  try {
    const result = importCsvFile(req.file.path, sourceName, groupId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============= GROUPES =============
router.get('/groups', (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
           COALESCE((SELECT COUNT(*) FROM salons WHERE group_id = g.id), 0) AS salons_count,
           COALESCE((SELECT COUNT(DISTINCT csv_source) FROM salons WHERE group_id = g.id), 0) AS csv_sources_count
    FROM salon_groups g
    ORDER BY g.name COLLATE NOCASE
  `).all();
  // Salons sans groupe
  const orphanCount = db.prepare("SELECT COUNT(*) AS n FROM salons WHERE group_id IS NULL").get().n;
  res.json({ groups, orphan_count: orphanCount });
});

router.post('/groups', express.json(), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  if (name.length > 100) return res.status(400).json({ error: 'Nom trop long' });
  try {
    const result = db.prepare('INSERT INTO salon_groups (name, description) VALUES (?, ?)').run(name, description);
    res.json({ id: result.lastInsertRowid, name, description });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Un groupe avec ce nom existe deja' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/groups/:id', express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = String(req.body?.name || '').trim();
  const description = req.body?.description != null ? String(req.body.description).trim() : null;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  try {
    const result = db.prepare("UPDATE salon_groups SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(name, description, id);
    if (result.changes === 0) return res.status(404).json({ error: 'Groupe introuvable' });
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Un groupe avec ce nom existe deja' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE supprime le groupe ; les salons ne sont PAS supprimes, ils deviennent "sans groupe"
router.delete('/groups/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tx = db.transaction(() => {
    db.prepare('UPDATE salons SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM salon_groups WHERE id = ?').run(id);
  });
  tx();
  res.json({ ok: true });
});

// Assigner tous les salons d'un csv_source a un groupe (ou null pour retirer)
router.put('/groups/assign-csv-source', express.json(), (req, res) => {
  const { csv_source, group_id } = req.body || {};
  if (!csv_source) return res.status(400).json({ error: 'csv_source requis' });
  const targetGroupId = group_id != null ? parseInt(group_id, 10) || null : null;
  const result = db.prepare('UPDATE salons SET group_id = ? WHERE csv_source = ?').run(targetGroupId, csv_source);
  res.json({ ok: true, moved: result.changes });
});

router.post('/screenshot/:slug', async (req, res) => {
  const result = await captureSalon(req.params.slug);
  if (result.success) res.json(result);
  else res.status(500).json(result);
});

const activeJobs = new Map();

router.post('/screenshot-batch', async (req, res) => {
  const { csv_source, group_id, only_missing = true } = req.body || {};
  let query = 'SELECT slug FROM salons';
  const params = [];
  const conds = [];
  if (csv_source) { conds.push('csv_source = ?'); params.push(csv_source); }
  if (group_id === 'none') conds.push('group_id IS NULL');
  else if (group_id) { conds.push('group_id = ?'); params.push(parseInt(group_id, 10)); }
  if (only_missing) conds.push('screenshot_path IS NULL');
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY id ASC';

  const slugs = db.prepare(query).all(...params).map(r => r.slug);
  const jobId = 'job_' + Date.now();
  activeJobs.set(jobId, { total: slugs.length, done: 0, errors: 0, status: 'running', last: null });

  res.json({ jobId, total: slugs.length });

  captureBatch(slugs, ({ done, total, last }) => {
    const job = activeJobs.get(jobId);
    if (!job) return;
    job.done = done;
    job.last = last;
    if (last && !last.success) job.errors++;
  }).then(() => {
    const job = activeJobs.get(jobId);
    if (job) job.status = 'finished';
  }).catch(e => {
    const job = activeJobs.get(jobId);
    if (job) { job.status = 'error'; job.error = e.message; }
  });
});

router.get('/job/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId) || getCleanJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job inconnu' });
  res.json(job);
});

router.post('/clean-names', express.json(), async (req, res) => {
  const { csv_source = null, group_id = null, force = false } = req.body || {};
  try {
    const result = await startCleanNames({ csvSource: csv_source, groupId: group_id, onlyMissing: true, force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/reset-clean-name/:slug', (req, res) => {
  // Reset = remettre nom_clean = nom (pour rester editable par humain)
  const result = db.prepare('UPDATE salons SET nom_clean = nom, nom_clean_at = NULL WHERE slug = ?').run(req.params.slug);
  res.json({ ok: true, updated: result.changes });
});

// Edition manuelle du nom final
router.put('/salon/:slug/nom-final', express.json(), (req, res) => {
  const value = String(req.body?.nom_final || '').trim();
  if (!value) return res.status(400).json({ error: 'nom_final ne peut pas etre vide' });
  if (value.length > 200) return res.status(400).json({ error: 'nom_final trop long (max 200)' });

  const result = db.prepare(`
    UPDATE salons
    SET nom_clean = ?, nom_clean_at = datetime('now'), updated_at = datetime('now'),
        screenshot_path = NULL, screenshot_generated_at = NULL
    WHERE slug = ?
  `).run(value, req.params.slug);

  if (result.changes === 0) return res.status(404).json({ error: 'Salon introuvable' });
  res.json({ ok: true, nom_final: value });
});

router.get('/export-csv', (req, res) => {
  const csvSource = req.query.csv_source || '';
  const groupId = req.query.group_id || '';
  const format = req.query.format || 'smartlead'; // 'smartlead' | 'full'
  const publicBase = process.env.PUBLIC_BASE_URL || 'https://coiffure.lamidetlm.com';
  const adminBase = process.env.ADMIN_BASE_URL || 'https://outil-coiffure.lamidetlm.com';

  let query = `SELECT slug, nom, nom_clean, ville, code_postal, adresse, telephone, email,
                      note_avis, nb_avis, lien_facebook, lien_instagram, lien_google_maps,
                      screenshot_path, csv_source, edit_token, group_id, data_json
               FROM salons`;
  const params = [];
  const conds = [];
  if (csvSource) { conds.push('csv_source = ?'); params.push(csvSource); }
  if (groupId === 'none') conds.push('group_id IS NULL');
  else if (groupId) { conds.push('group_id = ?'); params.push(parseInt(groupId, 10)); }
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY id ASC';

  const rows = db.prepare(query).all(...params);

  let enriched;
  let stringifyOpts;

  if (format === 'smartlead') {
    // Format minimal pour Smartlead : 7 colonnes exactement, virgule, sans BOM
    // Le salon_name utilise nom_clean (Nom final) pour les noms propres
    enriched = rows.map(r => {
      let firstName = '';
      try {
        const data = JSON.parse(r.data_json || '{}');
        const original = data.original_row || {};
        firstName = String(original["Prénom de l'email individuel"] || '').trim();
      } catch {}

      return {
        email: r.email || '',
        first_name: firstName,
        salon_name: (r.nom_clean && r.nom_clean.trim()) || r.nom || '',
        city: r.ville || '',
        preview_url: `${publicBase}/${r.slug}`,
        preview_image_url: r.screenshot_path ? `${publicBase}${r.screenshot_path}` : '',
        admin_url: r.edit_token ? `${adminBase}/edit/${r.slug}?token=${r.edit_token}` : ''
      };
    });
    stringifyOpts = { header: true, delimiter: ',' };
  } else {
    // Format complet pour usage interne (toutes les colonnes utiles)
    const groupNames = new Map(db.prepare('SELECT id, name FROM salon_groups').all().map(g => [g.id, g.name]));
    enriched = rows.map(r => ({
      slug: r.slug,
      nom_scrappe: r.nom,
      nom_final: (r.nom_clean && r.nom_clean.trim()) || r.nom,
      groupe: r.group_id ? (groupNames.get(r.group_id) || '') : '',
      ville: r.ville,
      code_postal: r.code_postal,
      adresse: r.adresse,
      telephone: r.telephone,
      email: r.email,
      note_avis: r.note_avis,
      nb_avis: r.nb_avis,
      lien_facebook: r.lien_facebook,
      lien_instagram: r.lien_instagram,
      lien_google_maps: r.lien_google_maps,
      csv_source: r.csv_source,
      URL_landing: `${publicBase}/${r.slug}`,
      URL_edition: r.edit_token ? `${adminBase}/edit/${r.slug}?token=${r.edit_token}` : '',
      Capture_ecran: r.screenshot_path ? `${publicBase}${r.screenshot_path}` : ''
    }));
    stringifyOpts = { header: true, delimiter: ';' };
  }

  const csv = stringify(enriched, stringifyOpts);
  const suffix = format === 'smartlead' ? 'smartlead' : 'full';
  const scope = csvSource || (groupId ? `group${groupId}` : 'all');
  const filename = `salons-${suffix}-${scope}-${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Smartlead format : pas de BOM (UTF-8 strict). Format full : BOM pour Excel.
  res.send(format === 'smartlead' ? csv : '﻿' + csv);
});

router.delete('/salon/:slug', (req, res) => {
  const result = db.prepare('DELETE FROM salons WHERE slug = ?').run(req.params.slug);
  res.json({ ok: true, deleted: result.changes });
});

router.delete('/csv-source/:name', (req, res) => {
  const result = db.prepare('DELETE FROM salons WHERE csv_source = ?').run(req.params.name);
  db.prepare('DELETE FROM csv_imports WHERE filename = ?').run(req.params.name);
  res.json({ ok: true, deleted: result.changes });
});

export default router;
