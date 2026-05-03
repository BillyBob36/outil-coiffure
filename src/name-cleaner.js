// Nettoyage des noms de salons via Azure OpenAI gpt-5.4-mini
// Batch processing, few-shot prompt, idempotent

import db from './db.js';
import { azureSlot } from './azure-rate-limiter.js';

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://johannfoundry.cognitiveservices.azure.com';
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4-mini-coiffeurs-app';
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
const AZURE_KEY = process.env.AZURE_OPENAI_KEY || '';

const BATCH_SIZE = 20; // noms par appel API

const SYSTEM_PROMPT = `Tu nettoies des noms de salons de coiffure issus d'un export Google Maps.

Ta mission : extraire LE VRAI NOM du salon, en retirant les suffixes marketing, listes de services et indications de ville superflues. Le nom doit etre COURT (h1 d'un site web).

Regles strictes :
1. LONGUEUR : MAX 30 CARACTERES (espaces inclus) ET MAX 3 MOTS. Un nom de salon doit pouvoir s'afficher sur 1-2 lignes du hero d'un site web. Si le nom contient des qualificatifs descriptifs ("Holistique", "Energetique", "Bien-etre", "Concept", "Studio", etc.), TU DOIS les retirer pour garder UNIQUEMENT la marque principale (prenom du coiffeur + activite, ou nom commercial).
2. CAPITALISATION FRANCAISE : un nom = majuscule au premier mot et aux noms propres, mais les articles, prepositions et conjonctions (de, du, des, le, la, les, et, a, au, aux, en, par, sur, pour, d', l') restent en minuscules SAUF en debut de nom. Exemples : "Salon de Morgane" (pas "Salon De Morgane"), "Cheveux d'or" (pas "Cheveux D'Or"). Si l'entree est en TOUT MAJUSCULES, applique cette regle.
3. Retire " - Coiffeur [ville]" / " - Salon de coiffure [ville]" / " - Hairdresser [...]" / " - Beautician"
4. Retire les parentheses contenant des listes de services : "(Perruques, Soins Capillaires)", "(ancien nom XYZ)"
5. Retire les listes de specialites apres tiret : " - Coiffeuse/formatrice extensions de cheveux"
6. Retire les indications de region/ville en suffixe quand redondantes
7. Si le nom contient un sous-titre commercial, garde la marque principale
8. Conserve les caracteres speciaux legitimes (apostrophes, accents, &, chiffres)
9. PRESERVE les noms deja courts et propres (< 25 caracteres sans tirets) : ne touche pas a leur orthographe.

PRIORITE D'EXTRACTION quand le nom est trop long :
a) Marque commerciale unique (ex: "Dessange", "Saint Algue", "Karactere")
b) Prenom + "Coiffure" / "Coiffeur" / "Salon" (ex: "Raphaelle Coiffure", "Salon de Cloe")
c) Prenom seul si c'est suffisant (ex: "Henao", "Bullerose")
Toujours sacrifier les adjectifs descriptifs (Holistique, Energetique, Modern, Premium, Bien-etre, Studio, Concept, etc.).

REPONDS UNIQUEMENT au format JSON suivant, rien d'autre, pas de texte avant ou apres :
{"results":[{"i":0,"name":"Nom propre"},{"i":1,"name":"Autre nom"},...]}

Le champ "i" doit reprendre exactement l'index de l'entree d'origine.

Exemples de transformations correctes :
- Entree: "DESSANGE - Coiffeur Bourg-en-Bresse" -> "Dessange"
- Entree: "LES EXTENSIONS D'ELODIE - Coiffeuse/formatrice extensions de cheveux Hair Luxury - Lyon - Rhone Alpes" -> "Les Extensions d'Elodie"
- Entree: "Alexano Coiffure - Coiffeur Bourg en Bresse (Perruques, Soins Capillaires)" -> "Alexano Coiffure"
- Entree: "32 Le Salon" -> "32 Le Salon" (deja propre)
- Entree: "Karactere" -> "Karactere" (deja propre)
- Entree: "Coiffure a domicile - Sylvie Pommerel - Bourg-en-Bresse / Marboz" -> "Sylvie Pommerel"
- Entree: "Hair By Mag (ancien nom Mod'Hair)" -> "Hair By Mag"
- Entree: "Cheveux d'or" -> "Cheveux d'or" (deja propre, "d'" reste en minuscules)
- Entree: "Salon de Morgane, Coiffeuse et Barbiere" -> "Salon de Morgane"
- Entree: "BARBER COIFFEUR BEHAR" -> "Barber Coiffeur Behar"
- Entree: "INDIVIDUO Coiffure" -> "Individuo Coiffure"
- Entree: "HENAO Divonne" -> "Henao"
- Entree: "ACCUEIL - 6e Sens Concept Store" -> "6e Sens"  (retire "Concept Store" pour rester court)
- Entree: "Saint Algue - Coiffeur Segny" -> "Saint Algue"
- Entree: "Franck Provost - Coiffeur Montlucon" -> "Franck Provost"
- Entree: "Coiffeur Coloriste Beauty Access | Turbans chimio, Perruques & Protheses Capillaires" -> "Beauty Access"
- Entree: "Bekahair beauty shop" -> "Bekahair"  (retire "beauty shop" pour rester court)
- Entree: "Mister John Coiffeur Barbier - Montlucon" -> "Mister John Coiffeur"  (max 3 mots)
- Entree: "Le Salon de Cloe - Ventes & conseils Perruques, Salon de coiffure & mariage" -> "Le Salon de Cloe"
- Entree: "Anthony Bouillot by Coralie - COIFFURE BIEN ETRE - Vichy" -> "Anthony Bouillot"  (retire "by Coralie")
- Entree: "Bullerose institut et Bullerose Coiffure & esthetique" -> "Bullerose"
- Entree: "Pampa coiffure" -> "Pampa Coiffure"
- Entree: "FRIZZ STYL" -> "Frizz Styl"
- Entree: "L'institut Laurie-Line Rozier" -> "L'institut Laurie-Line"  (retire le nom de famille pour rester court)
- Entree: "Raphaelle Coiffure Holistique Energetique" -> "Raphaelle Coiffure"  (retire "Holistique Energetique")
- Entree: "Studio Coiffure Bien-Etre & Spa Premium" -> "Studio Coiffure"  (retire les adjectifs)
- Entree: "Maison S Coiffure Concept" -> "Maison S Coiffure"  (retire "Concept")`;

// Filet de sécurité : si GPT renvoie un nom > MAX_NAME_LENGTH, on tronque proprement
// aux mots (jamais en milieu de mot). Garde au moins 1 mot.
const MAX_NAME_LENGTH = 30;

function enforceMaxLength(name) {
  if (!name || typeof name !== 'string') return name;
  const trimmed = name.trim();
  if (trimmed.length <= MAX_NAME_LENGTH) return trimmed;

  // Tronque aux mots successifs jusqu'à rentrer dans MAX_NAME_LENGTH
  const words = trimmed.split(/\s+/);
  let result = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = result + ' ' + words[i];
    if (candidate.length > MAX_NAME_LENGTH) break;
    result = candidate;
  }
  return result;
}

async function callAzure(items) {
  if (!AZURE_KEY) throw new Error('AZURE_OPENAI_KEY non configuree');

  const userPayload = JSON.stringify({
    items: items.map((it, i) => ({ i, raw: it.raw, ville: it.ville || '' }))
  });

  const url = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_API_VERSION}`;

  const body = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Voici les noms a nettoyer (JSON) :\n${userPayload}\n\nReponds avec le format JSON specifie dans les instructions.` }
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

// Job en memoire : { jobId: { total, done, errors, status, last } }
const cleanJobs = new Map();

export function getCleanJob(jobId) { return cleanJobs.get(jobId); }

// Lance un job de nettoyage. Si `slugs` est fourni, on traite exactement cette selection.
// Sinon, on filtre par csvSource/groupId et on respecte onlyMissing/force.
export async function startCleanNames({ csvSource = null, groupId = null, onlyMissing = true, force = false, slugs = null } = {}) {
  let rows;
  if (Array.isArray(slugs) && slugs.length > 0) {
    const placeholders = slugs.map(() => '?').join(',');
    rows = db.prepare(`SELECT id, slug, nom, ville FROM salons WHERE slug IN (${placeholders}) ORDER BY id ASC`).all(...slugs);
  } else {
    let query = 'SELECT id, slug, nom, ville FROM salons';
    const conds = [];
    const params = [];
    if (csvSource) { conds.push('csv_source = ?'); params.push(csvSource); }
    if (groupId === 'none') conds.push('group_id IS NULL');
    else if (groupId) { conds.push('group_id = ?'); params.push(parseInt(groupId, 10)); }
    if (onlyMissing && !force) conds.push("nom_clean_at IS NULL");
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY id ASC';
    rows = db.prepare(query).all(...params);
  }
  const jobId = 'clean_' + Date.now();
  const job = { id: jobId, total: rows.length, done: 0, errors: 0, status: 'running', updated: 0, last: null };
  cleanJobs.set(jobId, job);

  // Lancer en async sans bloquer la reponse HTTP
  processBatches(jobId, rows).catch(e => {
    job.status = 'error';
    job.error = e.message;
  });

  return { jobId, total: rows.length };
}

// Concurrence : Azure deployment a 250 req/min et 250k tokens/min.
// Avec batches de 20 noms (~1400 tokens chacun, ~2s par requete), 6 en parallele
// nous donne ~6/2 = 3 req/s = 180 req/min, large marge sous la limite.
const PARALLEL_BATCHES = 6;

async function processBatches(jobId, rows) {
  const job = cleanJobs.get(jobId);
  const updateStmt = db.prepare(`UPDATE salons SET nom_clean = ?, nom_clean_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`);

  // Decoupe en batches
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  // Worker pool : PARALLEL_BATCHES en parallele
  let nextBatch = 0;
  const workers = Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, async () => {
    while (true) {
      const idx = nextBatch++;
      if (idx >= batches.length) return;
      const batch = batches[idx];
      const items = batch.map(r => ({ id: r.id, raw: r.nom, ville: r.ville || '' }));

      try {
        // Wrap dans le sémaphore Azure global (partagé entre les 3 workers IA)
        const results = await azureSlot(() => callAzure(items));
        const byIndex = new Map(results.map(r => [Number(r.i), String(r.name || '').trim()]));

        const tx = db.transaction(() => {
          batch.forEach((row, k) => {
            let cleaned = byIndex.get(k);
            if (cleaned && cleaned.length > 0) {
              // Filet de sécurité : tronque si GPT a ignoré la limite 30 chars
              const truncated = enforceMaxLength(cleaned);
              if (truncated !== cleaned) {
                console.log(`[name-cleaner] GPT returned >${MAX_NAME_LENGTH}c "${cleaned}" → truncated to "${truncated}" (slug=${row.slug || row.id})`);
                cleaned = truncated;
              }
              updateStmt.run(cleaned, row.id);
              if (cleaned !== row.nom) job.updated++;
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
