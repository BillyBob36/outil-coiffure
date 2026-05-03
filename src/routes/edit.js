import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { buildSalonView } from '../defaults.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.env.SCREENSHOTS_DIR ? dirname(process.env.SCREENSHOTS_DIR) : './data', 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer en memoire (pour traiter via sharp avant ecriture disque)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 } // 12 MB max upload (sera compresse cote serveur)
});

// Auth par token : token dans query (?token=) ou header X-Edit-Token
function requireToken(req, res, next) {
  const slug = req.params.slug;
  const token = req.query.token || req.headers['x-edit-token'] || req.body?.token;
  if (!slug || !token) return res.status(401).json({ error: 'Token manquant' });

  const row = db.prepare('SELECT id, slug, edit_token FROM salons WHERE slug = ?').get(slug);
  if (!row) return res.status(404).json({ error: 'Salon introuvable' });
  if (!row.edit_token || row.edit_token !== token) return res.status(403).json({ error: 'Token invalide' });

  req.salon = row;
  next();
}

// GET /api/edit/:slug - retourne les donnees actuelles + structure pour l'admin
router.get('/edit/:slug', requireToken, (req, res) => {
  const row = db.prepare('SELECT * FROM salons WHERE id = ?').get(req.salon.id);
  const view = buildSalonView(row);
  res.json(view);
});

// PUT /api/edit/:slug - sauvegarde des overrides (JSON merge)
router.put('/edit/:slug', express.json({ limit: '2mb' }), requireToken, (req, res) => {
  const overrides = req.body?.overrides;
  if (!overrides || typeof overrides !== 'object') {
    return res.status(400).json({ error: 'overrides manquants' });
  }

  // Validation legere : taille raisonnable, types attendus
  if (overrides.services?.items && overrides.services.items.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 services' });
  }
  if (overrides.gallery?.images && overrides.gallery.images.length > 12) {
    return res.status(400).json({ error: 'Maximum 12 images dans la galerie' });
  }
  if (overrides.testimonials?.items && overrides.testimonials.items.length > 3) {
    return res.status(400).json({ error: 'Maximum 3 temoignages' });
  }

  db.prepare(`
    UPDATE salons
    SET overrides_json = ?, overrides_updated_at = datetime('now'), updated_at = datetime('now'),
        screenshot_path = NULL, screenshot_generated_at = NULL
    WHERE id = ?
  `).run(JSON.stringify(overrides), req.salon.id);

  // Retourne la vue mergee pour confirmer
  const row = db.prepare('SELECT * FROM salons WHERE id = ?').get(req.salon.id);
  res.json({ ok: true, view: buildSalonView(row) });
});

// DELETE /api/edit/:slug/overrides - reinitialiser depuis CSV
router.delete('/edit/:slug/overrides', requireToken, (req, res) => {
  db.prepare(`
    UPDATE salons SET overrides_json = NULL, overrides_updated_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.salon.id);
  res.json({ ok: true });
});

// POST /api/edit/:slug/upload-image - upload une image (hero ou galerie)
// Body : champ "image" (file), champ "kind" ("hero" | "gallery"), champ "index" (optionnel pour galerie)
router.post('/edit/:slug/upload-image', upload.single('image'), requireToken, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image' });
  const kind = req.body?.kind;
  if (!['hero', 'gallery'].includes(kind)) {
    return res.status(400).json({ error: 'kind doit etre hero ou gallery' });
  }

  const salonDir = join(UPLOADS_DIR, req.salon.slug);
  mkdirSync(salonDir, { recursive: true });

  let filename;
  let pipeline;

  if (kind === 'hero') {
    filename = `hero-${Date.now()}.jpg`;
    // Hero : 1920x1080 cover (couvre toute la zone), qualité 80, JPEG progressive
    // → ~150-300 KB par image
    pipeline = sharp(req.file.buffer)
      .rotate() // applique l'EXIF orientation
      .resize(1920, 1080, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true });
  } else {
    filename = `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    // Galerie : 1024px max côté long (fit: inside conserve le ratio natif),
    // qualité 80, JPEG progressive → ~80-180 KB par image
    pipeline = sharp(req.file.buffer)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true });
  }

  try {
    const buffer = await pipeline.toBuffer();
    const filepath = join(salonDir, filename);
    writeFileSync(filepath, buffer);
    const publicUrl = `/uploads/${req.salon.slug}/${filename}`;
    res.json({
      ok: true,
      url: publicUrl,
      kind,
      size: buffer.length,
      sizeKb: Math.round(buffer.length / 1024)
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur traitement image: ' + e.message });
  }
});

// DELETE /api/edit/:slug/upload-image?path=...
router.delete('/edit/:slug/upload-image', requireToken, (req, res) => {
  const path = req.query.path;
  if (!path || typeof path !== 'string') return res.status(400).json({ error: 'path manquant' });

  // Securite : doit commencer par /uploads/{slug}/ pour eviter de supprimer ailleurs
  const expected = `/uploads/${req.salon.slug}/`;
  if (!path.startsWith(expected)) return res.status(403).json({ error: 'path non autorise' });

  const filename = path.replace(expected, '');
  if (filename.includes('/') || filename.includes('..')) return res.status(400).json({ error: 'path invalide' });

  const filepath = join(UPLOADS_DIR, req.salon.slug, filename);
  if (existsSync(filepath)) {
    try { unlinkSync(filepath); } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ ok: true });
});

export default router;
