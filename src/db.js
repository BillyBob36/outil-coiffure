import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || './data/salons.db';

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  // 1. Tables (creates if absent ; pas d'index sur edit_token ici pour les vieilles BDD)
  db.exec(`
    CREATE TABLE IF NOT EXISTS salons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      ville TEXT,
      code_postal TEXT,
      adresse TEXT,
      telephone TEXT,
      email TEXT,
      latitude REAL,
      longitude REAL,
      types TEXT,
      note_avis REAL,
      nb_avis TEXT,
      heures_ouverture TEXT,
      lien_facebook TEXT,
      lien_instagram TEXT,
      lien_tiktok TEXT,
      lien_youtube TEXT,
      lien_google_maps TEXT,
      meta_image TEXT,
      titre_site TEXT,
      meta_description TEXT,
      site_internet_original TEXT,
      data_json TEXT NOT NULL,
      screenshot_path TEXT,
      screenshot_generated_at TEXT,
      csv_source TEXT,
      edit_token TEXT,
      overrides_json TEXT,
      overrides_updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_salons_slug ON salons(slug);
    CREATE INDEX IF NOT EXISTS idx_salons_csv_source ON salons(csv_source);
    CREATE INDEX IF NOT EXISTS idx_salons_screenshot ON salons(screenshot_path);

    CREATE TABLE IF NOT EXISTS csv_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL,
      skipped_rows INTEGER NOT NULL,
      original_headers TEXT,
      imported_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 2. Migrations idempotentes : pour les BDD existantes, ajoute les colonnes manquantes
  const cols = db.prepare("PRAGMA table_info(salons)").all().map(c => c.name);
  if (!cols.includes('edit_token')) db.exec("ALTER TABLE salons ADD COLUMN edit_token TEXT");
  if (!cols.includes('overrides_json')) db.exec("ALTER TABLE salons ADD COLUMN overrides_json TEXT");
  if (!cols.includes('overrides_updated_at')) db.exec("ALTER TABLE salons ADD COLUMN overrides_updated_at TEXT");
  if (!cols.includes('nom_clean')) db.exec("ALTER TABLE salons ADD COLUMN nom_clean TEXT");
  if (!cols.includes('nom_clean_at')) db.exec("ALTER TABLE salons ADD COLUMN nom_clean_at TEXT");

  // 3. Index sur edit_token : seulement maintenant que la colonne existe
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_salons_edit_token ON salons(edit_token) WHERE edit_token IS NOT NULL");

  // 4. Backfill : nom_clean doit TOUJOURS etre rempli (initialement = nom).
  //    Cela rend la colonne "Nom final" editable de facon homogene cote admin.
  db.exec("UPDATE salons SET nom_clean = nom WHERE nom_clean IS NULL OR nom_clean = ''");
}

initSchema();

if (process.argv[2] === 'init') {
  console.log('DB schema initialized at', DB_PATH);
  process.exit(0);
}

export default db;
