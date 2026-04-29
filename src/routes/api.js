import express from 'express';
import db from '../db.js';
import { buildSalonView } from '../defaults.js';

const router = express.Router();

router.get('/salon/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM salons WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Salon introuvable' });
  res.json(buildSalonView(row));
});

router.get('/salons', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 5000);
  const offset = parseInt(req.query.offset) || 0;
  const search = req.query.search || '';
  const csvSource = req.query.csv_source || '';

  let where = '1=1';
  const params = {};
  if (search) {
    where += ' AND (nom LIKE @search OR ville LIKE @search OR slug LIKE @search)';
    params.search = `%${search}%`;
  }
  if (csvSource) {
    where += ' AND csv_source = @csv_source';
    params.csv_source = csvSource;
  }

  const total = db.prepare(`SELECT COUNT(*) as n FROM salons WHERE ${where}`).get(params).n;
  const rows = db.prepare(`
    SELECT id, slug, nom, nom_clean, ville, code_postal, telephone, email, note_avis, nb_avis,
           screenshot_path, screenshot_generated_at, csv_source, edit_token,
           overrides_json IS NOT NULL AS has_overrides, overrides_updated_at,
           nom_clean_at, created_at
    FROM salons
    WHERE ${where}
    ORDER BY id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  res.json({ total, limit, offset, rows });
});

router.get('/csv-imports', (req, res) => {
  const rows = db.prepare(`
    SELECT id, filename, total_rows, imported_rows, skipped_rows, imported_at
    FROM csv_imports
    ORDER BY id DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM salons').get().n;
  const withScreenshot = db.prepare('SELECT COUNT(*) as n FROM salons WHERE screenshot_path IS NOT NULL').get().n;
  const withoutScreenshot = total - withScreenshot;
  const withCleanName = db.prepare("SELECT COUNT(*) as n FROM salons WHERE nom_clean IS NOT NULL AND nom_clean != ''").get().n;
  const csvSources = db.prepare('SELECT csv_source, COUNT(*) as n FROM salons GROUP BY csv_source ORDER BY n DESC').all();
  res.json({ total, withScreenshot, withoutScreenshot, withCleanName, csvSources });
});

export default router;
