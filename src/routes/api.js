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
  const groupId = req.query.group_id || ''; // peut etre 'none' pour les sans-groupe

  let where = '1=1';
  const params = {};
  if (search) {
    where += ' AND (nom LIKE @search OR nom_clean LIKE @search OR ville LIKE @search OR slug LIKE @search)';
    params.search = `%${search}%`;
  }
  if (csvSource) {
    where += ' AND csv_source = @csv_source';
    params.csv_source = csvSource;
  }
  if (groupId === 'none') {
    where += ' AND group_id IS NULL';
  } else if (groupId) {
    where += ' AND group_id = @group_id';
    params.group_id = parseInt(groupId, 10);
  }

  const total = db.prepare(`SELECT COUNT(*) as n FROM salons WHERE ${where}`).get(params).n;
  const rows = db.prepare(`
    SELECT id, slug, nom, nom_clean, ville, code_postal, telephone, email, note_avis, nb_avis,
           meta_description, overrides_json, data_json,
           screenshot_path, screenshot_generated_at, csv_source, edit_token,
           overrides_json IS NOT NULL AS has_overrides, overrides_updated_at,
           nom_clean_at, created_at
    FROM salons
    WHERE ${where}
    ORDER BY id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  // Enrichir : extraire presentation_scrappee et presentation_corrigee
  const enrichedRows = rows.map(r => {
    let presentationScrappee = r.meta_description || '';
    if (!presentationScrappee && r.data_json) {
      try {
        const data = JSON.parse(r.data_json);
        presentationScrappee = data.meta_description || '';
      } catch {}
    }
    let presentationCorrigee = '';
    if (r.overrides_json) {
      try {
        const overrides = JSON.parse(r.overrides_json);
        presentationCorrigee = overrides?.intro?.description || '';
      } catch {}
    }
    // On retire les colonnes brutes pour reduire la taille de la reponse
    const { meta_description, overrides_json, data_json, ...rest } = r;
    return { ...rest, presentation_scrappee: presentationScrappee, presentation_corrigee: presentationCorrigee };
  });

  res.json({ total, limit, offset, rows: enrichedRows });
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
  const groupId = req.query.group_id || '';
  let groupClause = '';
  const groupParams = {};
  if (groupId === 'none') {
    groupClause = ' WHERE group_id IS NULL';
  } else if (groupId) {
    groupClause = ' WHERE group_id = @group_id';
    groupParams.group_id = parseInt(groupId, 10);
  }

  const total = db.prepare('SELECT COUNT(*) as n FROM salons' + groupClause).get(groupParams).n;
  const withScreenshot = db.prepare('SELECT COUNT(*) as n FROM salons' + (groupClause ? groupClause + ' AND' : ' WHERE') + ' screenshot_path IS NOT NULL').get(groupParams).n;
  const withoutScreenshot = total - withScreenshot;
  const withCleanName = db.prepare("SELECT COUNT(*) as n FROM salons" + (groupClause ? groupClause + ' AND' : ' WHERE') + " nom_clean_at IS NOT NULL").get(groupParams).n;
  const csvSources = db.prepare('SELECT csv_source, COUNT(*) as n FROM salons' + groupClause + ' GROUP BY csv_source ORDER BY n DESC').all(groupParams);
  res.json({ total, withScreenshot, withoutScreenshot, withCleanName, csvSources });
});

export default router;
