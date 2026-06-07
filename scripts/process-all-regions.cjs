/* =============================================================================
   Orchestrateur import + traitement (Volet A) — toutes régions restantes.

   Usage (dans le container Helsinki) :
     node /app/process-all-regions.cjs import     → importe les CSV manquants (groupe par région)
     node /app/process-all-regions.cjs process    → lance les 4 actions région par région
     node /app/process-all-regions.cjs all        → import puis process

   Idempotent / reprenable :
     - import : slug unique → doublons skippés (re-run sans danger)
     - clean_names : onlyMissing=true → skip déjà nettoyés
     - domain_suggestions : force=false → skip déjà suggérés
     - captures : seulement les salons sans screenshot_path
   → si le container redémarre, on relance le même script, il reprend où ça en était.

   Log : append dans /data/process-log.txt (suivi via tail).
   ============================================================================= */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = '/data/salons.db';
const CSV_DIR = '/data/csv-import';
const LOG_PATH = '/data/process-log.txt';
const BATCH = 150; // taille de batch pour les captures

// Régions restantes à importer/traiter (les 3 premières — AURA, Bourgogne, Bretagne — sont déjà faites)
const REGIONS = [
  'centre-val-de-loire',
  'corse',
  'grand-est',
  'hauts-de-france',
  'ile-de-france',
  'normandie',
  'nouvelle-aquitaine',
  'occitanie',
  'paca',
  'pays-de-la-loire',
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

// Réplique deriveSourceFromFilename de admin.js (dernier segment du nom de fichier)
function deriveSource(filename) {
  const noExt = String(filename).replace(/\.(csv|tsv|txt)$/i, '');
  const parts = noExt.split(/[-_./\\\s]+/).filter(Boolean);
  return parts[parts.length - 1] || noExt || 'import';
}

function filesForRegion(region) {
  const all = fs.readdirSync(CSV_DIR);
  const prefix = `coiffeur-france-${region}-`;
  return all.filter(f => f.startsWith(prefix) && /\.csv$/i.test(f)).sort();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Attend la fin d'un sous-job (clean / presentation / domain)
async function waitJob(getJob, jobId, label) {
  let last = 0;
  while (true) {
    const j = getJob(jobId);
    if (!j) break;
    if (j.done !== last) { last = j.done; }
    if (j.status === 'finished' || j.status === 'error') {
      log(`    ${label}: ${j.status} done=${j.done}/${j.total} updated=${j.updated || 0} errors=${j.errors || 0}`);
      return j;
    }
    await sleep(1500);
  }
}

async function doImport() {
  const db = new Database(DB_PATH);
  const { importCsvFile } = await import('/app/src/csv-importer.js');

  for (const region of REGIONS) {
    const files = filesForRegion(region);
    if (files.length === 0) { log(`IMPORT ${region}: aucun fichier`); continue; }

    // Groupe par région (INSERT OR IGNORE puis lookup id)
    db.prepare('INSERT OR IGNORE INTO salon_groups (name) VALUES (?)').run(region);
    const grp = db.prepare('SELECT id FROM salon_groups WHERE name = ?').get(region);
    const groupId = grp ? grp.id : null;

    let imported = 0, skipped = 0;
    for (const f of files) {
      const src = deriveSource(f);
      try {
        const res = importCsvFile(path.join(CSV_DIR, f), src, groupId);
        imported += res.imported || 0;
        skipped += res.skipped || 0;
        log(`IMPORT ${region}/${src}: +${res.imported || 0} (skip ${res.skipped || 0})`);
      } catch (e) {
        log(`IMPORT ${region}/${src}: ERREUR ${e.message}`);
      }
    }
    log(`IMPORT ${region} TOTAL: +${imported} (skip ${skipped}) [group_id=${groupId}]`);
  }
  db.close();
  log('=== IMPORT TERMINÉ ===');
}

async function doProcess() {
  const db = new Database(DB_PATH);
  const { startCleanNames, getCleanJob } = await import('/app/src/name-cleaner.js');
  const { startCorrectPresentation, getPresentationJob } = await import('/app/src/presentation-cleaner.js');
  const { startDomainSuggestions, getDomainSuggestionsJob } = await import('/app/src/domain-suggester.js');
  const { captureBatchParallel } = await import('/app/src/screenshot-worker.js');

  for (const region of REGIONS) {
    const grp = db.prepare('SELECT id FROM salon_groups WHERE name = ?').get(region);
    if (!grp) { log(`PROCESS ${region}: pas de groupe (import manquant?), skip`); continue; }
    const groupId = grp.id;
    const slugs = db.prepare('SELECT slug FROM salons WHERE group_id = ? ORDER BY id').all(groupId).map(r => r.slug);
    if (slugs.length === 0) { log(`PROCESS ${region}: 0 salon, skip`); continue; }

    log(`### PROCESS ${region} (${slugs.length} salons) ###`);

    // 1. Nettoyer les noms (onlyMissing → reprend)
    try {
      const r = await startCleanNames({ slugs, onlyMissing: true });
      if (r.jobId) await waitJob(getCleanJob, r.jobId, 'clean_names');
      else log('    clean_names: rien à faire');
    } catch (e) { log(`    clean_names ERREUR: ${e.message}`); }

    // 2. Corriger présentation
    try {
      const r = await startCorrectPresentation({ slugs });
      if (r.jobId) await waitJob(getPresentationJob, r.jobId, 'presentation');
      else log('    presentation: rien à faire');
    } catch (e) { log(`    presentation ERREUR: ${e.message}`); }

    // 3. Suggérer domaines (force=false → skip déjà faits)
    try {
      const r = await startDomainSuggestions({ slugs, force: false });
      if (r.jobId) await waitJob(getDomainSuggestionsJob, r.jobId, 'domains');
      else log('    domains: rien à faire');
    } catch (e) { log(`    domains ERREUR: ${e.message}`); }

    // 4. Captures — seulement les salons sans screenshot (reprend)
    try {
      const missing = db.prepare(
        `SELECT slug FROM salons WHERE group_id = ? AND (screenshot_path IS NULL OR screenshot_path = '') ORDER BY id`
      ).all(groupId).map(r => r.slug);
      if (missing.length === 0) {
        log('    captures: toutes déjà faites');
      } else {
        log(`    captures: ${missing.length} à générer`);
        let done = 0;
        for (let i = 0; i < missing.length; i += BATCH) {
          const chunk = missing.slice(i, i + BATCH);
          await captureBatchParallel(chunk, undefined, () => {});
          done += chunk.length;
          log(`    captures: ${done}/${missing.length}`);
        }
      }
    } catch (e) { log(`    captures ERREUR: ${e.message}`); }

    log(`### PROCESS ${region} TERMINÉ ###`);
  }
  db.close();
  log('=== PROCESS TERMINÉ — TOUTES RÉGIONS ===');
}

(async () => {
  const phase = process.argv[2] || 'all';
  log(`>>> Orchestrateur démarré (phase=${phase})`);
  if (phase === 'import' || phase === 'all') await doImport();
  if (phase === 'process' || phase === 'all') await doProcess();
  log(`>>> Orchestrateur fini (phase=${phase})`);
  process.exit(0);
})().catch(e => { log(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
