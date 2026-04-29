import express from 'express';
import db from '../db.js';

const router = express.Router();

function rowToPublicSalon(row) {
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data_json || '{}'); } catch {}
  let hours = null;
  try { hours = row.heures_ouverture ? JSON.parse(row.heures_ouverture) : null; } catch {}
  return {
    slug: row.slug,
    nom: row.nom,
    ville: row.ville,
    code_postal: row.code_postal,
    adresse: row.adresse,
    telephone: row.telephone,
    email: row.email,
    latitude: row.latitude,
    longitude: row.longitude,
    types: row.types,
    note_avis: row.note_avis,
    nb_avis: row.nb_avis,
    heures_ouverture: hours,
    lien_facebook: row.lien_facebook,
    lien_instagram: row.lien_instagram,
    lien_tiktok: row.lien_tiktok,
    lien_youtube: row.lien_youtube,
    lien_google_maps: row.lien_google_maps,
    meta_image: row.meta_image,
    titre_site: row.titre_site,
    meta_description: row.meta_description,
    has_real_website: data.has_real_website
  };
}

router.get('/salon/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM salons WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Salon introuvable' });
  res.json(rowToPublicSalon(row));
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
    SELECT id, slug, nom, ville, code_postal, telephone, email, note_avis, nb_avis,
           screenshot_path, screenshot_generated_at, csv_source, created_at
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
  const csvSources = db.prepare('SELECT csv_source, COUNT(*) as n FROM salons GROUP BY csv_source ORDER BY n DESC').all();
  res.json({ total, withScreenshot, withoutScreenshot, csvSources });
});

export default router;
