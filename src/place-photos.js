// Récupération des vraies photos Google d'un salon (via Places Photo API) et
// stockage au MÊME format que le pipeline de scrape existant : renditions
// _lg/_th sur /data/salon-photos/{dir}/ + lignes salon_photos. Puis application
// automatique d'un héros + galerie pour que le démo soit immédiatement « réel ».
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import db from './db.js';
import { SALON_PHOTOS_DIR, dedupPhotosByPhash } from './picker-core.js';
import { photoUri } from './places-client.js';
import { applyHero, applyGallery } from './photo-apply.js';

function dirFor(googleId) { return String(googleId).replace(/:/g, '_'); }

// place.photos[i].name = "places/{placeId}/photos/{ref}" → photo_id = ref nettoyé.
function safePhotoId(name) {
  const ref = String(name || '').split('/photos/')[1] || String(name || '');
  return (ref.replace(/[^A-Za-z0-9_-]/g, '') || ('p' + Date.now())).slice(0, 180);
}

async function downloadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('download HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Télécharge + stocke jusqu'à `max` photos Google d'un lieu.
 * @returns {Promise<Array<{photo_id,w,h,lowdef}>>} photos stockées
 */
export async function fetchAndStorePlacePhotos({ googleId, photos, nom = null, ville = null, csvSource = 'manuel', max = 10 }) {
  if (!googleId || !Array.isArray(photos) || !photos.length) return [];
  const dir = dirFor(googleId);
  const dirPath = join(SALON_PHOTOS_DIR, dir);
  await mkdir(dirPath, { recursive: true });
  const insert = db.prepare(`
    INSERT INTO salon_photos (google_id, dir, photo_id, kind, position, w, h, lowdef, lg_kb, th_kb, nom, ville, csv_source)
    VALUES (@google_id, @dir, @photo_id, @kind, @position, @w, @h, @lowdef, @lg_kb, @th_kb, @nom, @ville, @csv_source)
    ON CONFLICT(google_id, photo_id) DO NOTHING
  `);
  const stored = [];
  const list = photos.slice(0, max);
  for (let i = 0; i < list.length; i++) {
    try {
      const photo_id = safePhotoId(list[i].name);
      const uri = await photoUri(list[i].name, { maxWidthPx: 1600 });
      if (!uri) continue;
      const orig = await downloadBuffer(uri);
      const meta = await sharp(orig).metadata();
      const w = meta.width || null, h = meta.height || null;
      const longSide = Math.max(w || 0, h || 0);
      const lowdef = longSide && longSide < 1000 ? 1 : 0;
      const lgBuf = await sharp(orig).rotate().resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, progressive: true, mozjpeg: true }).toBuffer();
      const thBuf = await sharp(orig).rotate().resize(500, 500, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, progressive: true, mozjpeg: true }).toBuffer();
      await writeFile(join(dirPath, `${photo_id}_lg.jpg`), lgBuf);
      await writeFile(join(dirPath, `${photo_id}_th.jpg`), thBuf);
      insert.run({ google_id: googleId, dir, photo_id, kind: 'place', position: i, w, h, lowdef, lg_kb: Math.round(lgBuf.length / 1024), th_kb: Math.round(thBuf.length / 1024), nom, ville, csv_source: csvSource });
      stored.push({ photo_id, w, h, lowdef });
    } catch (e) {
      console.warn(`[place-photos] ${googleId} photo ${i} fail: ${e.message}`);
    }
  }
  return stored;
}

/**
 * Choisit + applique un héros (1 photo) et une galerie (le reste) depuis les
 * photos stockées d'un salon. Héros = 1ère paysage non basse-déf (heuristique).
 */
export async function autoApplyHeroGallery(slug, googleId) {
  const raw = db.prepare('SELECT id, photo_id, dir, lowdef, w, h FROM salon_photos WHERE google_id = ? ORDER BY COALESCE(position,99), id').all(googleId);
  if (!raw.length) return { hero: null, gallery: 0 };
  const dedup = await dedupPhotosByPhash(raw);
  const photos = (dedup.kept && dedup.kept.length) ? dedup.kept : raw;
  const landscape = photos.find((p) => p.w && p.h && p.w > p.h && !p.lowdef);
  const okdef = photos.find((p) => !p.lowdef);
  const hero = landscape || okdef || photos[0];
  await applyHero({ slug, photoId: hero.photo_id, position: 'centre', googleId });
  const galleryIds = photos.filter((p) => p.photo_id !== hero.photo_id).slice(0, 12).map((p) => p.photo_id);
  let galleryCount = 0;
  if (galleryIds.length) {
    const r = await applyGallery({ slug, photoIds: galleryIds, mode: 'replace', googleId });
    galleryCount = r.count;
  }
  return { hero: hero.photo_id, gallery: galleryCount };
}

/** Orchestrateur : fetch + stockage + application auto. À lancer en arrière-plan. */
export async function enrichSalonWithPlacePhotos({ slug, googleId, photos, nom, ville, csvSource = 'manuel' }) {
  const stored = await fetchAndStorePlacePhotos({ googleId, photos, nom, ville, csvSource });
  if (!stored.length) return { stored: 0, hero: null, gallery: 0 };
  const applied = await autoApplyHeroGallery(slug, googleId);
  return { stored: stored.length, ...applied };
}
