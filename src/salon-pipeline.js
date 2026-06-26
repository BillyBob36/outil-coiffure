// Pipeline d'enrichissement complet déclenché à la CRÉATION d'un salon « à l'unité ».
// Reproduit l'ordre + les dépendances du bouton « Run » du Tableau de bord :
//   1. (si Places) photos      : fetch Google + héros + galerie
//   2. Phase IA EN PARALLÈLE   : nettoyage du nom + correction présentation + suggestions de domaine
//   3. capture FINALE          : APRÈS l'IA, pour que le screenshot reflète le nom nettoyé
//                                + la présentation corrigée (cf. commentaire d'orchestration admin.js)
import { enrichSalonWithPlacePhotos } from './place-photos.js';
import { startCleanNames, getCleanJob } from './name-cleaner.js';
import { startCorrectPresentation, getPresentationJob } from './presentation-cleaner.js';
import { startDomainSuggestions, getDomainSuggestionsJob } from './domain-suggester.js';
import { captureSalon } from './screenshot-worker.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Statut en mémoire des pipelines récents (clé = slug) — lu par /photo-status.
const pipelineStatus = new Map();
export function getPipelineStatus(slug) { return pipelineStatus.get(slug) || null; }

async function waitJob(getJob, jobId, { timeoutMs = 150000, intervalMs = 1500 } = {}) {
  if (!jobId) return null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = getJob(jobId);
    if (!j || j.status === 'finished' || j.status === 'error') return j;
    await sleep(intervalMs);
  }
  return getJob(jobId);
}

/**
 * @param {Object} p { slug, googleId?, photos?, nom?, ville?, withPhotos }
 * @returns {Promise<Object>} statut final
 */
export async function runCreationPipeline({ slug, googleId = null, photos = null, nom = null, ville = null, withPhotos = false }) {
  const st = { slug, step: 'start', photos: 0, names: false, presentation: false, domains: false, captured: false, done: false, startedAt: Date.now() };
  pipelineStatus.set(slug, st);
  if (pipelineStatus.size > 60) pipelineStatus.delete(pipelineStatus.keys().next().value);

  try {
    // 1. PHOTOS (si issu de Google Places)
    if (withPhotos && googleId && Array.isArray(photos) && photos.length) {
      st.step = 'photos';
      const r = await enrichSalonWithPlacePhotos({ slug, googleId, photos, nom, ville });
      st.photos = r.stored || 0;
    }

    // 2. PHASE IA EN PARALLÈLE (nom + présentation + domaines), on attend qu'elles soient TOUTES finies
    st.step = 'ia';
    const [cn, cp, ds] = await Promise.all([
      startCleanNames({ slugs: [slug], force: true }).catch((e) => { console.warn(`[pipeline] clean-names ${slug}: ${e.message}`); return null; }),
      startCorrectPresentation({ slugs: [slug] }).catch((e) => { console.warn(`[pipeline] presentation ${slug}: ${e.message}`); return null; }),
      startDomainSuggestions({ slugs: [slug], force: true }).catch((e) => { console.warn(`[pipeline] domains ${slug}: ${e.message}`); return null; }),
    ]);
    await Promise.all([
      cn ? waitJob(getCleanJob, cn.jobId).then(() => { st.names = true; }) : Promise.resolve(),
      cp ? waitJob(getPresentationJob, cp.jobId).then(() => { st.presentation = true; }) : Promise.resolve(),
      ds ? waitJob(getDomainSuggestionsJob, ds.jobId).then(() => { st.domains = true; }) : Promise.resolve(),
    ]);

    // 3. CAPTURE FINALE — après l'IA pour refléter le contenu corrigé
    st.step = 'capture';
    await captureSalon(slug).catch((e) => console.warn(`[pipeline] capture ${slug}: ${e.message}`));
    st.captured = true;

    st.step = 'done';
    st.done = true;
    console.log(`[pipeline] ${slug} terminé : photos=${st.photos} names=${st.names} pres=${st.presentation} domains=${st.domains} capture=${st.captured}`);
  } catch (e) {
    st.step = 'error';
    st.error = e.message;
    st.done = true;
    console.warn(`[pipeline] ${slug} échec : ${e.message}`);
  }
  return st;
}
