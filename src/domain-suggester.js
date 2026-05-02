/**
 * Domain suggester via Azure OpenAI gpt-5.4-mini.
 *
 * Pour chaque salon, génère 10 noms de domaine SANS extension TLD.
 * Le check de dispo + prix est fait au moment du signup côté frontend
 * (pas ici), via OVH API. C'est juste une pré-génération texte.
 *
 * Sortie en DB (salons.domain_suggestions_json) :
 *   [{ "name": "salonjean", "rank": 1 },
 *    { "name": "salon-jean", "rank": 2 },
 *    ... (10 entries)]
 *
 * Idempotency : si `force=false`, skip les salons déjà suggérés.
 */

import db from './db.js';
import { azureSlot } from './azure-rate-limiter.js';

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://johannfoundry.cognitiveservices.azure.com';
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4-mini-coiffeurs-app';
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
const AZURE_KEY = process.env.AZURE_OPENAI_KEY || '';

const BATCH_SIZE = 10;       // 10 salons par appel API (chaque salon = 10 noms = ~150 tokens output)
const PARALLEL_BATCHES = 6;  // identique aux autres workers Azure (sémaphore globalise au-dessus)

const SYSTEM_PROMPT = `Tu generes des idees de noms de domaine pour des sites web professionnels de salons de coiffure.

Pour chaque salon, genere EXACTEMENT 10 idees de NOMS (sans extension TLD).

Regles strictes :
1. Reponds UNIQUEMENT avec un JSON valide : {"results":[{"i":<index>,"names":["nom1","nom2",...,"nom10"]}, ...]}
2. Le champ "i" reprend exactement l'index de l'entree d'origine.
3. EXACTEMENT 10 noms par salon, classes par qualite (1er = le meilleur).
4. Caracteres autorises UNIQUEMENT : a-z minuscule, 0-9, et le tiret "-" SEULEMENT au milieu.
5. Pas d'espaces, pas d'accents, pas de majuscules, pas de points.
6. Maximum 25 caracteres par nom.
7. Pas d'extension (.fr, .com, etc.) — juste le nom seul.
8. Variete dans les 10 noms :
   - 3-4 versions courtes (juste le nom du salon, sans rien d'autre, ou variantes simples)
   - 2-3 versions avec ville (nom-ville, ville-nom)
   - 2-3 versions avec metier (coiffure, salon, hairsalon, hair, beaute)
   - 1-2 variantes creatives (le-, ma-, chez-, art-, style-, atelier-, maison-)
9. Privilegier court, memorable, facile a dire au telephone.
10. JAMAIS de marques deposees tierces (gucci, nike, dior, etc.).
11. Si le nom du salon a des accents (Cesar, Cafe), retire-les (cesar, cafe).

Exemples corrects :
Pour "Salon de Morgane" a "Lyon" :
["salonmorgane", "morganecoiffure", "morganelyon", "salondemorgane", "lemorgane", "morganesalon", "lyon-morgane", "chezmorgane", "morgane-coiffure", "morganestyle"]

Pour "L'institut Laurie-Line Rozier" a "Bourg-en-Bresse" :
["laurieline", "laurielinerozier", "institutlaurieline", "rozier-coiffure", "laurieline-bourg", "linerozier", "lerozier", "laurie-coiffure", "rozierstyle", "atelier-rozier"]

Pour "32 Le Salon" a "Paris" :
["32lesalon", "lesalon32", "32coiffure", "32salonparis", "salon32", "le32paris", "32-coiffure", "atelier32", "le-32-salon", "32style"]

Mauvais (ne jamais faire) :
- "Salon Morgane" (espace)
- "Salon-Morgane" (majuscule)
- "salonmorgane.fr" (extension)
- "salon" (trop generique, marque non differenciee)
- "morgane!" (caractere special)`;

function sanitizeName(name) {
  // Defense contre prompt injection : tronque + escape les caracteres susceptibles
  // de modifier la structure du prompt JSON.
  if (!name) return '';
  return String(name).slice(0, 80).replace(/[\r\n"\\]/g, ' ').trim();
}

function sanitizeCity(city) {
  if (!city) return '';
  return String(city).slice(0, 60).replace(/[\r\n"\\]/g, ' ').trim();
}

async function callAzure(items) {
  if (!AZURE_KEY) throw new Error('AZURE_OPENAI_KEY non configuree');

  const userPayload = JSON.stringify({
    items: items.map((it, i) => ({
      i,
      name: sanitizeName(it.name),
      city: sanitizeCity(it.city)
    }))
  });

  const url = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_API_VERSION}`;

  const body = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Voici les salons (JSON) :\n${userPayload}\n\nReponds avec le format JSON specifie dans les instructions.` }
    ],
    max_completion_tokens: 4096,
    response_format: { type: 'json_object' }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': AZURE_KEY, 'Content-Type': 'application/json' },
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

/**
 * Filtre/normalise un nom de domaine généré par GPT pour s'assurer qu'il
 * respecte les règles. Si invalide → retourne null (le nom sera dropé).
 */
function normalizeDomainName(name) {
  if (!name || typeof name !== 'string') return null;
  let n = name.toLowerCase().trim();
  // Retire toute extension si jamais GPT en a glissé une
  n = n.replace(/\.(fr|com|net|org|coiffure|paris|salon)$/i, '');
  // Retire caractères non-autorisés (garde a-z 0-9 -)
  n = n.replace(/[^a-z0-9-]/g, '');
  // Retire les tirets en début/fin
  n = n.replace(/^-+|-+$/g, '');
  // Compresse les tirets multiples
  n = n.replace(/-{2,}/g, '-');
  // Validation finale
  if (n.length < 3) return null;
  if (n.length > 25) n = n.slice(0, 25).replace(/-+$/, '');
  return n;
}

// Job en mémoire : { jobId: { total, done, errors, status, last } }
const suggestJobs = new Map();

export function getDomainSuggestionsJob(jobId) { return suggestJobs.get(jobId); }

/**
 * Lance un job de pré-génération de noms de domaine.
 *
 * Si `slugs` est fourni, traite exactement cette sélection.
 * Sinon, filtre par csvSource/groupId. `force=false` skip les déjà suggérés.
 */
export async function startDomainSuggestions({ csvSource = null, groupId = null, force = false, slugs = null } = {}) {
  let rows;
  if (Array.isArray(slugs) && slugs.length > 0) {
    const placeholders = slugs.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT id, slug, nom, nom_clean, ville, domain_suggestions_at
      FROM salons WHERE slug IN (${placeholders}) ORDER BY id ASC
    `).all(...slugs);
  } else {
    let query = `
      SELECT id, slug, nom, nom_clean, ville, domain_suggestions_at
      FROM salons
    `;
    const conds = [];
    const params = [];
    if (csvSource) { conds.push('csv_source = ?'); params.push(csvSource); }
    if (groupId === 'none') conds.push('group_id IS NULL');
    else if (groupId) { conds.push('group_id = ?'); params.push(parseInt(groupId, 10)); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY id ASC';
    rows = db.prepare(query).all(...params);
  }

  // Filtre : si !force, skip les salons qui ont déjà des suggestions
  if (!force) {
    rows = rows.filter(r => !r.domain_suggestions_at);
  }

  const jobId = 'domains_' + Date.now();
  const job = { id: jobId, total: rows.length, done: 0, errors: 0, status: 'running', updated: 0, last: null };
  suggestJobs.set(jobId, job);

  // Lance en async sans bloquer la réponse HTTP
  processBatches(jobId, rows).catch(e => {
    job.status = 'error';
    job.error = e.message;
  });

  return { jobId, total: rows.length };
}

async function processBatches(jobId, rows) {
  const job = suggestJobs.get(jobId);
  const updateStmt = db.prepare(`
    UPDATE salons
    SET domain_suggestions_json = ?, domain_suggestions_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);

  // Découpe en batches
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  // Worker pool : PARALLEL_BATCHES batches en parallèle, mais wrapped dans
  // azureSlot() qui plafonne globalement le nombre d'appels Azure simultanés
  // (sémaphore partagé entre les 3 workers Azure).
  let nextBatch = 0;
  const workers = Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, async () => {
    while (true) {
      const idx = nextBatch++;
      if (idx >= batches.length) return;
      const batch = batches[idx];
      const items = batch.map(r => ({
        id: r.id,
        // Préfère nom_clean (déjà nettoyé par GPT) sinon nom brut
        name: (r.nom_clean && r.nom_clean.trim()) || r.nom,
        city: r.ville || ''
      }));

      try {
        // Le sémaphore Azure plafonne le total concurrent à AZURE_MAX_CONCURRENT
        const results = await azureSlot(() => callAzure(items));
        const byIndex = new Map(results.map(r => [Number(r.i), r.names]));

        const tx = db.transaction(() => {
          batch.forEach((row, k) => {
            const rawNames = byIndex.get(k);
            if (!Array.isArray(rawNames)) return;
            // Normalise + dédupe
            const seen = new Set();
            const cleaned = [];
            for (const raw of rawNames) {
              const n = normalizeDomainName(raw);
              if (n && !seen.has(n)) {
                seen.add(n);
                cleaned.push({ name: n, rank: cleaned.length + 1 });
              }
              if (cleaned.length >= 10) break;
            }
            if (cleaned.length > 0) {
              updateStmt.run(JSON.stringify(cleaned), row.id);
              job.updated++;
            }
          });
        });
        tx();
        job.done += batch.length;
        job.last = batch[batch.length - 1].nom;
      } catch (e) {
        job.errors += batch.length;
        job.last = `ERROR: ${e.message}`;
      }
    }
  });

  await Promise.all(workers);
  job.status = 'finished';
}
