// Nettoyage / uniformisation du texte de presentation des salons via Azure OpenAI gpt-5.4-mini
// Recupere la meta_description du CSV, la fait nettoyer/reformuler par GPT, et stocke
// le resultat dans overrides_json.intro.description (pour qu'il s'affiche sur la landing)

import db from './db.js';

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://johannfoundry.cognitiveservices.azure.com';
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4-mini-coiffeurs-app';
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
const AZURE_KEY = process.env.AZURE_OPENAI_KEY || '';

const BATCH_SIZE = 8; // descriptions par appel API (plus longues que des noms, donc plus petits batches)

const SYSTEM_PROMPT = `Tu reformules le texte de presentation d'un salon de coiffure pour qu'il apparaisse sur sa landing page (section "Notre Histoire" / introduction).

Ta mission : pour chaque salon, transformer la description brute (souvent une meta-description SEO bourree de mots-cles) en un texte naturel, chaleureux et bref qui donne envie d'entrer dans le salon.

Regles strictes :
1. Style editorial : phrases naturelles, ton chaleureux et professionnel. Pas de listes de services ni de mots-cles SEO.
2. Longueur : entre 1 et 3 phrases courtes (35 a 80 mots maximum).
3. Centrer sur l'experience client (accueil, expertise, ambiance) et non sur les specialites techniques.
4. Si la description originale est deja bonne (naturelle, breve), reecris-la legerement pour la rendre encore plus chaleureuse.
5. Si la description originale est vide ou inexistante, genere un texte generique mais personnalise avec le nom et la ville du salon.
6. Ne mentionne PAS les coordonnees, telephone, adresse — ces infos sont ailleurs sur la page.
7. Ne mentionne pas explicitement "site web", "Google", "SEO".
8. Francais correct, ponctuation soignee, pas de tout-majuscules.

REPONDS UNIQUEMENT au format JSON suivant, rien d'autre, pas de texte avant ou apres :
{"results":[{"i":0,"description":"Texte reformule"},{"i":1,"description":"Autre texte"},...]}

Le champ "i" doit reprendre exactement l'index de l'entree d'origine.

Exemples de transformation :

Entree :
{"i":0,"nom":"32 Le Salon","ville":"Bourg-en-Bresse","raw":"Salon de coiffure dans l'Ain et la Saône-et-Loire : coupes, colorations, balayages et soins sur-mesure, pour révéler votre style unique."}

Sortie :
{"i":0,"description":"Au cœur de Bourg-en-Bresse, notre équipe vous accueille pour révéler votre style à travers des prestations sur mesure. Coupes, couleurs, soins : chaque visite est pensée pour vous, dans une ambiance chaleureuse et professionnelle."}

---

Entree :
{"i":0,"nom":"Karactère","ville":"Bourg-en-Bresse","raw":"Des soins capillaires et des prestations coiffure de qualité à Bourg-en-Bresse et aux alentours dans une ambiance qui allie simplicité et convivialité ! Soin des cheveux, coupe classique ou tendance, reflets couleur, mèches, boucles..."}

Sortie :
{"i":0,"description":"Chez Karactère, simplicité et convivialité sont nos maîtres-mots. Notre équipe vous reçoit à Bourg-en-Bresse pour des prestations soignées, dans une atmosphère où vous vous sentez à l'aise dès votre arrivée."}

---

Entree (description vide) :
{"i":0,"nom":"Salon Sophie","ville":"Lyon","raw":""}

Sortie :
{"i":0,"description":"À Lyon, Salon Sophie vous accueille avec attention pour des prestations soignées dans une ambiance chaleureuse. Notre équipe met son savoir-faire au service de votre style."}`;

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

async function processBatches(jobId, rows) {
  const job = presentationJobs.get(jobId);
  const updateStmt = db.prepare(`UPDATE salons SET overrides_json = ?, overrides_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const items = batch.map(r => {
      // Recup meta_description : colonne directe OU dans data_json
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
      const results = await callAzure(items);
      const byIndex = new Map(results.map(r => [Number(r.i), String(r.description || '').trim()]));

      const tx = db.transaction(() => {
        batch.forEach((row, idx) => {
          const cleaned = byIndex.get(idx);
          if (!cleaned || cleaned.length < 10) return; // skip si reponse vide ou trop courte

          // Merger dans overrides_json existants pour ne pas ecraser d'autres champs
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

  job.status = 'finished';
}
