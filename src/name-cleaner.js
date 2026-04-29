// Nettoyage des noms de salons via Azure OpenAI gpt-5.4-mini
// Batch processing, few-shot prompt, idempotent

import db from './db.js';

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://johannfoundry.cognitiveservices.azure.com';
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4-mini-coiffeurs-app';
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
const AZURE_KEY = process.env.AZURE_OPENAI_KEY || '';

const BATCH_SIZE = 20; // noms par appel API

const SYSTEM_PROMPT = `Tu nettoies des noms de salons de coiffure issus d'un export Google Maps.

Ta mission : extraire LE VRAI NOM du salon, en retirant les suffixes marketing, listes de services et indications de ville superflues.

Regles strictes :
1. CAPITALISATION FRANCAISE : un nom = majuscule au premier mot et aux noms propres, mais les articles, prepositions et conjonctions (de, du, des, le, la, les, et, a, au, aux, en, par, sur, pour, d', l') restent en minuscules SAUF en debut de nom. Exemples : "Salon de Morgane" (pas "Salon De Morgane"), "Cheveux d'or" (pas "Cheveux D'Or"), "Marion Coiffure a Domicile" (pas "Marion Coiffure A Domicile"), "Le Salon de Cloe" (pas "Le Salon De Cloe"). Si l'entree est en TOUT MAJUSCULES, applique cette regle. Si elle est deja correcte, ne change rien.
2. Retire " - Coiffeur [ville]" / " - Salon de coiffure [ville]" / " - Hairdresser [...]" / " - Beautician"
3. Retire les parentheses contenant des listes de services : "(Perruques, Soins Capillaires)", "(ancien nom XYZ)"
4. Retire les listes de specialites apres tiret : " - Coiffeuse/formatrice extensions de cheveux"
5. Retire les indications de region/ville en suffixe quand redondantes
6. Si le nom contient un sous-titre commercial, garde la marque principale
7. Conserve les caracteres speciaux legitimes (apostrophes, accents, &, chiffres)
8. PRESERVE les noms deja propres et courts : ne touche PAS aux noms < 25 caracteres sans tirets

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
- Entree: "Marion Coiffure a Domicile" -> "Marion Coiffure a Domicile" (deja propre, pas de "À" majuscule au milieu)
- Entree: "Cheveux d'or" -> "Cheveux d'or" (deja propre, "d'" reste en minuscules)
- Entree: "Salon de Morgane, Coiffeuse et Barbiere" -> "Salon de Morgane"
- Entree: "BARBER COIFFEUR BEHAR" -> "Barber Coiffeur Behar"
- Entree: "INDIVIDUO Coiffure" -> "Individuo Coiffure"
- Entree: "HENAO Divonne" -> "Henao"
- Entree: "ACCUEIL - 6e Sens Concept Store" -> "6e Sens Concept Store"
- Entree: "Saint Algue - Coiffeur Segny" -> "Saint Algue"
- Entree: "Franck Provost - Coiffeur Montlucon" -> "Franck Provost"
- Entree: "Coiffeur Coloriste Beauty Access | Turbans chimio, Perruques & Protheses Capillaires" -> "Beauty Access"
- Entree: "Bekahair beauty shop" -> "Bekahair Beauty Shop"
- Entree: "Mister John Coiffeur Barbier - Montlucon" -> "Mister John Coiffeur Barbier"
- Entree: "Le Salon de Cloe - Ventes & conseils Perruques, Salon de coiffure & mariage" -> "Le Salon de Cloe"
- Entree: "Anthony Bouillot by Coralie - COIFFURE BIEN ETRE - Vichy" -> "Anthony Bouillot by Coralie"
- Entree: "Bullerose institut et Bullerose Coiffure & esthetique" -> "Bullerose"
- Entree: "Pampa coiffure" -> "Pampa Coiffure"
- Entree: "FRIZZ STYL" -> "Frizz Styl"
- Entree: "L'institut Laurie-Line Rozier" -> "L'institut Laurie-Line Rozier" (deja propre)`;

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

// Lance un job de nettoyage. only_missing = true : ne traite que les noms non encore traites par l'IA
export async function startCleanNames({ csvSource = null, groupId = null, onlyMissing = true, force = false } = {}) {
  let query = 'SELECT id, slug, nom, ville FROM salons';
  const conds = [];
  const params = [];
  if (csvSource) { conds.push('csv_source = ?'); params.push(csvSource); }
  if (groupId === 'none') conds.push('group_id IS NULL');
  else if (groupId) { conds.push('group_id = ?'); params.push(parseInt(groupId, 10)); }
  // "onlyMissing" = noms non encore traites par l'IA (nom_clean_at est NULL).
  // "force" = re-traiter tous les noms quel que soit leur etat (utile apres amelioration du prompt).
  if (onlyMissing && !force) conds.push("nom_clean_at IS NULL");
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY id ASC';

  const rows = db.prepare(query).all(...params);
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

async function processBatches(jobId, rows) {
  const job = cleanJobs.get(jobId);
  const updateStmt = db.prepare(`UPDATE salons SET nom_clean = ?, nom_clean_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const items = batch.map(r => ({ id: r.id, raw: r.nom, ville: r.ville || '' }));

    try {
      const results = await callAzure(items);
      // Map result.i -> name
      const byIndex = new Map(results.map(r => [Number(r.i), String(r.name || '').trim()]));

      const tx = db.transaction(() => {
        batch.forEach((row, idx) => {
          const cleaned = byIndex.get(idx);
          if (cleaned && cleaned.length > 0 && cleaned !== row.nom) {
            updateStmt.run(cleaned, row.id);
            job.updated++;
          } else if (cleaned && cleaned === row.nom) {
            // Nom deja propre : on enregistre quand meme nom_clean = nom pour ne pas re-traiter
            updateStmt.run(cleaned, row.id);
          }
        });
      });
      tx();
      job.done += batch.length;
      job.last = batch[batch.length - 1].nom;
    } catch (e) {
      job.errors += batch.length;
      job.last = `ERROR: ${e.message}`;
      // On ne bloque pas le job en cas d'echec ponctuel, on continue
    }
  }

  job.status = 'finished';
}
