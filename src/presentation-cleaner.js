// Nettoyage / uniformisation du texte de presentation des salons via Azure OpenAI gpt-5.4-mini
// Recupere la meta_description du CSV, la fait nettoyer/reformuler par GPT, et stocke
// le resultat dans overrides_json.intro.description (pour qu'il s'affiche sur la landing)

import db from './db.js';
import { azureSlot } from './azure-rate-limiter.js';

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://johannfoundry.cognitiveservices.azure.com';
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4-mini-coiffeurs-app';
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
const AZURE_KEY = process.env.AZURE_OPENAI_KEY || '';

const BATCH_SIZE = 8; // descriptions par appel API (plus longues que des noms, donc plus petits batches)

const SYSTEM_PROMPT = `Tu corriges le texte de presentation d'un salon de coiffure pour sa landing page.

Tu dois distinguer 2 cas selon que la description d'origine ("raw") existe ou non.

==========================================================
CAS 1 — Le champ "raw" CONTIENT deja un texte (non vide)
==========================================================
Tu te contentes d'une CORRECTION LEGERE, sans reformuler ni reecrire :
- Corrige UNIQUEMENT les fautes d'orthographe, de grammaire et de ponctuation.
- Conserve le SENS, le CONTENU et les INFORMATIONS d'origine intacts.
- Conserve le TON et le STYLE de l'auteur.
- Garde la MEME longueur (ne resume pas, n'ajoute pas).
- NE supprime PAS de mention de services, de villes, de specialites.
- Tu peux retoucher la formulation UNIQUEMENT si elle est cassee ou n'a aucun sens grammatical.
- Si le texte est deja correct, retourne-le quasi-identique (sauf accents/typo).

EXEMPLES CAS 1 :

Entree : {"i":0,"nom":"Viva la Vie","ville":"Aurillac","raw":"Coupes, colorations et coiffures femme, découvrez les salons de coiffure Viva la Vie. Plus de 110 salons et experts près de vous, proposant une large palette de prestations : couleurs, balayage, soins et conseils pour vos cheveux."}
Sortie : {"i":0,"description":"Coupes, colorations et coiffures femme : découvrez les salons de coiffure Viva la Vie. Plus de 110 salons et experts près de vous proposent une large palette de prestations : couleurs, balayage, soins et conseils pour vos cheveux."}

Entree : {"i":0,"nom":"Karactere","ville":"Bourg-en-Bresse","raw":"Des soins capillaires et des prestations coiffure de qualité à Bourg-en-Bresse et aux alentours dans une ambiance qui allie simplicité et convivialité ! Soin des cheveux, coupe classique ou tendance, reflets couleur, mèches, boucles..."}
Sortie : {"i":0,"description":"Des soins capillaires et des prestations de coiffure de qualité à Bourg-en-Bresse et aux alentours, dans une ambiance qui allie simplicité et convivialité. Soin des cheveux, coupe classique ou tendance, reflets, couleur, mèches, boucles…"}

Entree : {"i":0,"nom":"Salon X","ville":"Paris","raw":"salon coiffure paris coupe femme homme pas cher tarif petit prix"}
(formulation cassee, juste une enumeration de mots-cles SEO)
Sortie : {"i":0,"description":"Salon de coiffure à Paris : coupes femme et homme à des tarifs accessibles."}

==========================================================
CAS 2 — Le champ "raw" est VIDE ou null
==========================================================
Tu CREES un texte naturel a partir du nom et de la ville :
- 1 a 3 phrases courtes, 35 a 80 mots
- Style editorial chaleureux et professionnel
- Centre sur l'experience client (accueil, ambiance, expertise)
- Utilise le nom du salon et la ville pour le rendre personnel
- Pas de mention de coordonnees, telephone, adresse
- Pas de mots-cles SEO

EXEMPLE CAS 2 :

Entree : {"i":0,"nom":"Salon Sophie","ville":"Lyon","raw":""}
Sortie : {"i":0,"description":"À Lyon, Salon Sophie vous accueille avec attention pour des prestations soignées dans une ambiance chaleureuse. Notre équipe met son savoir-faire au service de votre style."}

==========================================================
FORMAT DE REPONSE
==========================================================
REPONDS UNIQUEMENT au format JSON suivant, rien d'autre, pas de texte avant ou apres :
{"results":[{"i":0,"description":"..."},{"i":1,"description":"..."}]}

Le champ "i" doit reprendre exactement l'index de l'entree d'origine.`;

async function callAzure(items) {
  if (!AZURE_KEY) throw new Error('AZURE_OPENAI_KEY non configuree');

  const userPayload = JSON.stringify({
    items: items.map((it, i) => ({
      i,
      nom: it.nom || '',
      ville: it.ville || '',
      raw: it.raw || ''
    }))
  });

  const url = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_API_VERSION}`;

  const body = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Voici les descriptions a reformuler (JSON) :\n${userPayload}\n\nReponds avec le format JSON specifie dans les instructions.` }
    ],
    max_completion_tokens: 4096,
    response_format: { type: 'json_object' }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': AZURE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Azure ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Reponse Azure vide');

  let parsed;
  try { parsed = JSON.parse(content); } catch (e) {
    throw new Error('JSON invalide dans la reponse Azure: ' + content.slice(0, 200));
  }
  if (!parsed?.results || !Array.isArray(parsed.results)) {
    throw new Error('Format JSON inattendu: ' + content.slice(0, 200));
  }

  return parsed.results;
}

const presentationJobs = new Map();

export function getPresentationJob(jobId) { return presentationJobs.get(jobId); }

export async function startCorrectPresentation({ slugs = [] } = {}) {
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return { jobId: null, total: 0 };
  }

  // Recuperer les salons avec leur meta_description et overrides actuels
  const placeholders = slugs.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, slug, nom, nom_clean, ville, meta_description, data_json, overrides_json
    FROM salons
    WHERE slug IN (${placeholders})
  `).all(...slugs);

  const jobId = 'pres_' + Date.now();
  const job = { id: jobId, total: rows.length, done: 0, errors: 0, status: 'running', updated: 0, last: null };
  presentationJobs.set(jobId, job);

  processBatches(jobId, rows).catch(e => {
    job.status = 'error';
    job.error = e.message;
  });

  return { jobId, total: rows.length };
}

// Concurrence : presentations ont ~2400 tokens par batch de 8, ~3s.
// Avec 6 en parallele : 6/3 = 2 req/s = 120 req/min. Tokens : 6×2400 = 14k tokens utilises
// par cycle de 3s, soit 280k tokens/min. C'est legerement au-dessus du token rate limit (250k/min).
// On reduit a 5 pour rester sous la limite.
const PARALLEL_BATCHES = 5;

async function processBatches(jobId, rows) {
  const job = presentationJobs.get(jobId);
  const updateStmt = db.prepare(`UPDATE salons SET overrides_json = ?, overrides_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`);

  // Decoupe en batches
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  let nextBatch = 0;
  const workers = Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, async () => {
    while (true) {
      const idx = nextBatch++;
      if (idx >= batches.length) return;
      const batch = batches[idx];
      const items = batch.map(r => {
        let metaDesc = r.meta_description || '';
        if (!metaDesc) {
          try {
            const data = JSON.parse(r.data_json || '{}');
            metaDesc = data.meta_description || '';
          } catch {}
        }
        const displayName = (r.nom_clean && r.nom_clean.trim()) || r.nom || '';
        return { id: r.id, slug: r.slug, nom: displayName, ville: r.ville || '', raw: metaDesc };
      });

      try {
        // Wrap dans le sémaphore Azure global (partagé entre les 3 workers IA)
        const results = await azureSlot(() => callAzure(items));
        const byIndex = new Map(results.map(r => [Number(r.i), String(r.description || '').trim()]));

        const tx = db.transaction(() => {
          batch.forEach((row, k) => {
            const cleaned = byIndex.get(k);
            if (!cleaned || cleaned.length < 10) return;

            let overrides = {};
            try { overrides = row.overrides_json ? JSON.parse(row.overrides_json) : {}; } catch {}
            if (!overrides.intro) overrides.intro = {};
            overrides.intro.description = cleaned;

            updateStmt.run(JSON.stringify(overrides), row.id);
            job.updated++;
          });
        });
        tx();
        job.done += batch.length;
        job.last = batch[batch.length - 1].slug;
      } catch (e) {
        job.errors += batch.length;
        job.last = `ERROR: ${e.message}`;
      }
    }
  });

  await Promise.all(workers);
  job.status = 'finished';
}
