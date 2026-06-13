// Scorer photo-picker : pour un google_id donné, charge ses photos (_lg du volume),
// dédupe visuellement, injecte les critères actifs + few-shot RAG, appelle gpt-4o,
// persiste le résultat dans picker_scorings.
//
// IMPORTANT : selected_image_index peut être null ("aucune ne convient") — résultat
// valide, pas une erreur. Porté depuis salon-hero-picker/src/scorer.js.

import { existsSync } from 'node:fs';
import db from './db.js';
import { callVision } from './picker-azure.js';
import {
  photoLgPath, dedupPhotosByPhash,
  describeAndEmbedPhoto, retrieveSimilarFeedbacks, formatFeedbacksForPrompt,
} from './picker-core.js';

const MAX_PHOTOS_PER_SALON = parseInt(process.env.MAX_PHOTOS_PER_SALON || '15', 10);

export function getActiveCriteria() {
  const row = db.prepare('SELECT id, label, rubric_json FROM picker_criteria WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
  if (!row) throw new Error('Aucune version de critères active');
  return { id: row.id, label: row.label, rubric: JSON.parse(row.rubric_json) };
}

function buildSystemPrompt(rubric) {
  const criteriaText = rubric
    .map((c, i) => `${i + 1}. ${c.name} (poids ${c.weight}%)\n   ${c.description}`)
    .join('\n\n');
  return `Tu es un expert en direction artistique pour landing pages de salons de coiffure.
Tu reçois plusieurs photos d'un même salon, scrapées depuis Google Maps.
Chaque photo est précédée d'un libellé "## Image N" (N = 1, 2, 3, ...) qui sert d'identifiant.
Ton job : choisir LA photo qui ferait le meilleur FOND HERO (bandeau 16:9 plein écran en haut du site).

## Critères pondérés
${criteriaText}

## Règles importantes
- Tu DOIS pouvoir retourner selected_image_index = null si AUCUNE photo de la sélection ne convient à un usage hero (ex: que des selfies, photos floues, ou résultats coiffure en gros plan).
- Sois HONNÊTE et SÉLECTIF. Mieux vaut "aucune ne convient" qu'un mauvais choix forcé.
- Donne un score 0-3 par photo : 0=inutilisable, 1=médiocre, 2=correcte, 3=excellente pour hero.
- Référence-toi UNIQUEMENT aux images par leur numéro (image_index = 1, 2, 3, ...), JAMAIS par un autre identifiant.
- Rédige TOUS les textes (selected_reason, main_strength, main_weakness, overall_assessment) en FRANÇAIS.

## Format de sortie OBLIGATOIRE (JSON strict)
{
  "selected_image_index": integer | null,
  "selected_reason": "string (1-2 phrases sur le pourquoi de ce choix, OU pourquoi rien ne convient)",
  "per_image": [
    { "image_index": integer, "score": 0|1|2|3, "main_strength": "1 phrase", "main_weakness": "1 phrase (ou 'aucun')" }
  ],
  "overall_assessment": "string (1 phrase synthèse)"
}`;
}

/**
 * Score les photos d'un salon (par google_id).
 * @param {string} googleId
 * @param {Object} [opts] { useRag=true, slug=null }
 */
export async function scoreSalonPhotos(googleId, opts = {}) {
  const { useRag = true, slug = null } = opts;

  const meta = db.prepare('SELECT nom, ville FROM salon_photos WHERE google_id = ? LIMIT 1').get(googleId);
  if (!meta) throw new Error(`Aucune photo indexée pour google_id=${googleId}`);

  const rawPhotos = db.prepare(`
    SELECT id, photo_id, dir, kind, position, lowdef
    FROM salon_photos WHERE google_id = ?
    ORDER BY COALESCE(position, 99), id
    LIMIT ?
  `).all(googleId, MAX_PHOTOS_PER_SALON * 3);

  const existing = rawPhotos.filter((p) => existsSync(photoLgPath(p.dir, p.photo_id)));
  const dedupResult = await dedupPhotosByPhash(existing);
  const photos = dedupResult.kept.slice(0, MAX_PHOTOS_PER_SALON);

  if (photos.length === 0) {
    const ins = db.prepare(`
      INSERT INTO picker_scorings (google_id, slug, selected_photo_id, reasoning, error)
      VALUES (?, ?, NULL, 'Aucune photo exploitable pour ce salon', 'no_photos')
    `).run(googleId, slug);
    return { scoring_id: ins.lastInsertRowid, google_id: googleId, selected_photo_id: null, no_photos: true };
  }

  const criteria = getActiveCriteria();
  const systemPrompt = buildSystemPrompt(criteria.rubric);

  // Few-shot RAG sur l'embedding de la 1ère photo candidate
  let ragSection = '';
  let ragExamplesCount = 0;
  if (useRag) {
    try {
      const firstPhoto = photos[0];
      const embResult = await describeAndEmbedPhoto(firstPhoto.id, photoLgPath(firstPhoto.dir, firstPhoto.photo_id));
      const feedbacks = retrieveSimilarFeedbacks(embResult.embedding);
      if (feedbacks.length > 0) {
        ragSection = formatFeedbacksForPrompt(feedbacks);
        ragExamplesCount = feedbacks.length;
      }
    } catch (e) {
      console.warn(`[picker-scorer] RAG retrieve fail (continuing without): ${e.message}`);
    }
  }

  const userText = `Salon: ${meta.nom || '?'} — ${meta.ville || '?'}
Voici ${photos.length} photo${photos.length > 1 ? 's' : ''} de ce salon. Chaque image est précédée de son libellé "## Image N".
Évalue chaque image, choisis-en une (ou aucune) comme meilleur fond hero, et réponds en JSON strict selon le schéma indiqué.${ragSection}`;

  const images = photos.map((p, idx) => ({
    type: 'image_path',
    value: photoLgPath(p.dir, p.photo_id),
    detail: 'high',
    label: `## Image ${idx + 1}`,
  }));

  let result;
  try {
    result = await callVision({ systemPrompt, userText, images, maxTokens: 2000, temperature: 0.2 });
  } catch (e) {
    const ins = db.prepare(`
      INSERT INTO picker_scorings (google_id, slug, selected_photo_id, criteria_version_id, error)
      VALUES (?, ?, NULL, ?, ?)
    `).run(googleId, slug, criteria.id, e.message.slice(0, 500));
    return { scoring_id: ins.lastInsertRowid, google_id: googleId, error: e.message };
  }

  const c = result.content;
  const indexToPhotoId = (idx) => {
    const i = parseInt(idx, 10);
    if (!Number.isFinite(i) || i < 1 || i > photos.length) return null;
    return photos[i - 1].photo_id;
  };
  const selectedPhotoId = c.selected_image_index != null ? indexToPhotoId(c.selected_image_index) : null;
  const perPhoto = Array.isArray(c.per_image)
    ? c.per_image.map((p) => {
        const photoId = indexToPhotoId(p.image_index);
        if (!photoId) return null;
        return { photo_id: photoId, score: p.score, main_strength: p.main_strength, main_weakness: p.main_weakness };
      }).filter(Boolean)
    : [];
  let overallScore = null;
  if (selectedPhotoId) {
    overallScore = perPhoto.find((p) => p.photo_id === selectedPhotoId)?.score ?? null;
  }

  const ins = db.prepare(`
    INSERT INTO picker_scorings (
      google_id, slug, selected_photo_id, overall_score, reasoning, per_photo_scores,
      criteria_version_id, rag_examples_used, model_used,
      tokens_input, tokens_output, cost_eur, latency_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    googleId, slug, selectedPhotoId, overallScore,
    c.selected_reason || c.overall_assessment || '',
    JSON.stringify(perPhoto),
    criteria.id, ragExamplesCount, result.model,
    result.usage.prompt_tokens, result.usage.completion_tokens,
    result.cost_eur, result.latency_ms
  );

  return {
    scoring_id: ins.lastInsertRowid,
    google_id: googleId,
    slug,
    nom: meta.nom,
    ville: meta.ville,
    selected_photo_id: selectedPhotoId,
    overall_score: overallScore,
    reasoning: c.selected_reason,
    overall_assessment: c.overall_assessment,
    per_photo: perPhoto,
    cost_eur: result.cost_eur,
    latency_ms: result.latency_ms,
    rag_examples_used: ragExamplesCount,
  };
}

/**
 * Prochain salon à scorer : priorité aux salons présents dans la DB principale
 * (= ceux dont la démo existe, donc résultat directement applicable en héro).
 * Fallback : n'importe quel google_id de salon_photos jamais scoré.
 */
export function pickNextUnscoredSalon({ dbOnly = true } = {}) {
  const inDb = db.prepare(`
    SELECT s.slug, s.google_id, COALESCE(NULLIF(TRIM(s.nom_clean), ''), s.nom) AS nom, s.ville
    FROM salons s
    WHERE s.google_id IS NOT NULL AND s.google_id != ''
      AND EXISTS (SELECT 1 FROM salon_photos sp WHERE sp.google_id = s.google_id)
      AND NOT EXISTS (SELECT 1 FROM picker_scorings sc WHERE sc.google_id = s.google_id AND sc.error IS NULL)
    ORDER BY s.id LIMIT 1
  `).get();
  if (inDb || dbOnly) return inDb || null;
  const any = db.prepare(`
    SELECT DISTINCT sp.google_id, sp.nom, sp.ville
    FROM salon_photos sp
    WHERE NOT EXISTS (SELECT 1 FROM picker_scorings sc WHERE sc.google_id = sp.google_id AND sc.error IS NULL)
    LIMIT 1
  `).get();
  return any ? { slug: null, ...any } : null;
}
