// Photo-picker : helpers communs.
//   - chemins des renditions (/data/salon-photos/{dir}/{photo_id}_lg.jpg | _th.jpg)
//   - pHash (dHash 64 bits via sharp, cache en DB) + dédup visuelle
//   - description visuelle + embedding (cache picker_photo_desc) + retrieval RAG
// Porté depuis salon-hero-picker (phash.js jimp → sharp ; embedder/retriever quasi tels quels).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import db from './db.js';
import { callVision, callEmbedding } from './picker-azure.js';

export const SALON_PHOTOS_DIR = process.env.SALON_PHOTOS_DIR || '/data/salon-photos';

export function photoLgPath(dir, photoId) {
  return join(SALON_PHOTOS_DIR, dir, `${photoId}_lg.jpg`);
}
export function photoThPath(dir, photoId) {
  return join(SALON_PHOTOS_DIR, dir, `${photoId}_th.jpg`);
}

// ---------------------------------------------------------------------------
// pHash : dHash 8x8 (64 bits, hex 16 chars) calculé sur la vignette _th.
// Suffisant pour détecter les doublons exacts/quasi-exacts que Google renvoie
// sous 2 photo_ids différents (place + legacy). Cache : salon_photos.phash.
// ---------------------------------------------------------------------------
async function computeDHash(filePath) {
  const { data } = await sharp(filePath)
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
    }
  }
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

export async function computeOrLoadPhash(photoDbId, filePath) {
  const cached = db.prepare('SELECT phash FROM salon_photos WHERE id = ?').get(photoDbId);
  if (cached?.phash) return cached.phash;
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const hash = await computeDHash(filePath);
    db.prepare('UPDATE salon_photos SET phash = ? WHERE id = ?').run(hash, photoDbId);
    return hash;
  } catch (e) {
    console.warn(`[picker-phash] fail photo id=${photoDbId}: ${e.message}`);
    return null;
  }
}

/**
 * Dédupe une liste de photos par pHash. Garde 1 photo par groupe identique ;
 * si preferredPhotoId est dans un groupe, c'est elle qui est conservée.
 * @param {Array<{id, photo_id, dir, ...}>} photos
 */
export async function dedupPhotosByPhash(photos, preferredPhotoId = null) {
  if (!photos || photos.length <= 1) return { kept: photos || [], dedupedCount: 0 };
  const hashes = await Promise.all(
    photos.map((p) => computeOrLoadPhash(p.id, photoThPath(p.dir, p.photo_id)))
  );
  const representative = new Map();
  for (let i = 0; i < photos.length; i++) {
    const h = hashes[i];
    if (!h) continue;
    const isPreferred = preferredPhotoId && photos[i].photo_id === preferredPhotoId;
    const existing = representative.get(h);
    if (!existing || isPreferred) representative.set(h, photos[i]);
  }
  const seen = new Set();
  const kept = [];
  for (let i = 0; i < photos.length; i++) {
    const h = hashes[i];
    if (!h) { kept.push(photos[i]); continue; }
    if (seen.has(h)) continue;
    seen.add(h);
    kept.push(representative.get(h));
  }
  return { kept, dedupedCount: photos.length - kept.length };
}

// ---------------------------------------------------------------------------
// Embedder : décrit la photo en attributs visuels (gpt-4o, detail low sur _th)
// puis embed le texte → vecteur 1536D pour le RAG. Cache picker_photo_desc.
// ---------------------------------------------------------------------------
const DESCRIBE_PROMPT = `Tu décris cette photo prise dans/par un salon de coiffure en attributs visuels objectifs.
Format JSON : {
  "main_subject": "intérieur_salon | vitrine | client_coupe | mannequin_tête | selfie_employé | détail_produit | autre",
  "people_present": "aucune | dos_silhouette | mannequin | visage_reconnaissable",
  "composition": "paysage_large | paysage_normal | carré | portrait_étroit",
  "lighting": "naturelle | studio | sombre | surexposée",
  "color_palette": ["3-5 couleurs dominantes en mots"],
  "ambiance": ["3-5 mots-clés ex: chic, vintage, moderne, naturel, sombre, lumineux"],
  "quality": "haute | correcte | basse | floue",
  "text_or_watermark": "non | logo_salon | texte_promo | filigrane",
  "suitable_for_hero_intuition": "très_bien | correct | médiocre | non"
}
Sois factuel. Pas d'interprétation marketing.`;

export async function describeAndEmbedPhoto(photoDbId, filePath) {
  const existing = db.prepare('SELECT embedding_json FROM picker_photo_desc WHERE photo_db_id = ?').get(photoDbId);
  if (existing?.embedding_json) {
    return { cached: true, embedding: JSON.parse(existing.embedding_json) };
  }
  const vis = await callVision({
    systemPrompt: 'Tu es un analyste visuel pour catalogage e-commerce.',
    userText: DESCRIBE_PROMPT,
    images: [{ type: 'image_path', value: filePath, detail: 'low' }],
    maxTokens: 400,
    temperature: 0.1,
  });
  const desc = vis.content;
  const summaryText = [
    `Sujet: ${desc.main_subject || '?'}`,
    `Personnes: ${desc.people_present || '?'}`,
    `Composition: ${desc.composition || '?'}`,
    `Lumière: ${desc.lighting || '?'}`,
    `Couleurs: ${(desc.color_palette || []).join(', ')}`,
    `Ambiance: ${(desc.ambiance || []).join(', ')}`,
    `Qualité: ${desc.quality || '?'}`,
    `Texte: ${desc.text_or_watermark || '?'}`,
    `Hero-intuition: ${desc.suitable_for_hero_intuition || '?'}`,
  ].join(' | ');
  const emb = await callEmbedding(summaryText);
  db.prepare(`
    INSERT INTO picker_photo_desc (photo_db_id, description, tags_json, embedding_json, embedding_dims)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (photo_db_id) DO UPDATE SET
      description = excluded.description, tags_json = excluded.tags_json,
      embedding_json = excluded.embedding_json, embedding_dims = excluded.embedding_dims
  `).run(photoDbId, summaryText, JSON.stringify(desc), JSON.stringify(emb.vector), emb.dims);
  return {
    cached: false,
    description: desc,
    summaryText,
    embedding: emb.vector,
    cost_eur: (vis.cost_eur || 0) + (emb.cost_eur || 0),
  };
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ---------------------------------------------------------------------------
// Retriever RAG : top-K feedbacks humains les plus similaires visuellement.
// Cold start : tant que < RAG_ENABLE_MIN_FEEDBACK feedbacks commentés, [] (pas de RAG).
// ---------------------------------------------------------------------------
const TOP_K = parseInt(process.env.RAG_TOP_K || '5', 10);
const MIN_FEEDBACK = parseInt(process.env.RAG_ENABLE_MIN_FEEDBACK || '3', 10);

export function retrieveSimilarFeedbacks(queryEmbedding, k = TOP_K) {
  if (!queryEmbedding || queryEmbedding.length === 0) return [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM picker_feedback WHERE comment IS NOT NULL AND comment != ''`).get().c;
  if (total < MIN_FEEDBACK) return [];
  const rows = db.prepare(`
    SELECT pf.id, pf.rating, pf.comment, pf.photo_id, pf.corrected_photo_id, pf.embedding_json,
           COALESCE(sp.nom, pf.google_id) AS salon_nom
    FROM picker_feedback pf
    LEFT JOIN salon_photos sp ON sp.google_id = pf.google_id AND sp.photo_id = pf.photo_id
    WHERE pf.embedding_json IS NOT NULL AND pf.comment IS NOT NULL AND pf.comment != ''
  `).all();
  const scored = rows.map((r) => {
    let emb;
    try { emb = JSON.parse(r.embedding_json); } catch { emb = null; }
    return { ...r, similarity: emb ? cosineSimilarity(queryEmbedding, emb) : 0 };
  });
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k).map(({ embedding_json, ...rest }) => rest);
}

export function formatFeedbacksForPrompt(feedbacks) {
  if (!feedbacks || feedbacks.length === 0) return '';
  const lines = feedbacks.map((f, i) => {
    let verdict, body;
    if (f.rating === 'good') {
      verdict = '✓ BON CHOIX (à reproduire)';
      body = `Mon retour : "${f.comment}"`;
    } else if (f.rating === 'bad') {
      verdict = '✗ MAUVAIS CHOIX (à éviter)';
      body = `J'ai rejeté le choix de l'IA précédent. Mon retour : "${f.comment}"`;
    } else {
      verdict = '✏ CORRECTION';
      body = f.corrected_photo_id
        ? `L'IA avait choisi une photo visuellement similaire à celle-ci ; mais une autre photo du salon aurait été préférable. Mon retour : "${f.comment}"`
        : `L'IA s'est trompée sur ce choix. Mon retour : "${f.comment}"`;
    }
    return `[Exemple ${i + 1}] (similarité ${(f.similarity * 100).toFixed(0)}%) ${verdict}\n  Salon: ${f.salon_nom || '?'}\n  ${body}`;
  });
  return `\n\n# Apprentissages de mes choix passés (par similarité visuelle)\n` +
         `Voici des exemples de feedbacks que j'ai donnés sur des photos visuellement similaires à celles que tu vas évaluer maintenant.\n` +
         `Tiens-en compte : reproduis les bons choix, évite les mauvais, et applique les corrections.\n\n` +
         lines.join('\n\n');
}
