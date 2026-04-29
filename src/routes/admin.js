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
  try {
    const result = importCsvFile(req.file.path, sourceName);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/screenshot/:slug', async (req, res) => {
  const result = await captureSalon(req.params.slug);
  if (result.success) res.json(result);
  else res.status(500).json(result);
});

const activeJobs = new Map();

router.post('/screenshot-batch', async (req, res) => {
  const { csv_source, only_missing = true } = req.body || {};
  let query = 'SELECT slug FROM salons';
  const params = [];
  const conds = [];
  if (csv_source) { conds.push('csv_source = ?'); params.push(csv_source); }
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
  const { csv_source = null, force = false } = req.body || {};
  try {
    const result = await startCleanNames({ csvSource: csv_source, onlyMissing: true, force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/reset-clean-name/:slug', (req, res) => {
  const result = db.prepare('UPDATE salons SET nom_clean = NULL, nom_clean_at = NULL WHERE slug = ?').run(req.params.slug);
  res.json({ ok: true, updated: result.changes });
});

router.get('/export-csv', (req, res) => {
  const csvSource = req.query.csv_source || '';
  const publicBase = process.env.PUBLIC_BASE_URL || 'https://coiffure.lamidetlm.com';
  const adminBase = process.env.ADMIN_BASE_URL || 'https://outil-coiffure.lamidetlm.com';

  let query = `SELECT slug, nom, nom_clean, ville, code_postal, adresse, telephone, email,
                      note_avis, nb_avis, lien_facebook, lien_instagram, lien_google_maps,
                      screenshot_path, csv_source, edit_token, data_json
               FROM salons`;
  const params = [];
  if (csvSource) { query += ' WHERE csv_source = ?'; params.push(csvSource); }
  query += ' ORDER BY id ASC';

  const rows = db.prepare(query).all(...params);

  const enriched = rows.map(r => ({
    slug: r.slug,
    nom: (r.nom_clean && r.nom_clean.trim()) || r.nom,
    nom_original: r.nom,
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

  const csv = stringify(enriched, { header: true, delimiter: ';' });
  const filename = `salons-enrichi-${csvSource || 'all'}-${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);
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
