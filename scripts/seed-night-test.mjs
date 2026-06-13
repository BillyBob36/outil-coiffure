// Seed du salon de test pour la vérif nocturne (DB salons-night.db locale OU prod via DB_PATH).
// Salon réel scrapé : ESPACE COIFFURE (Font-Romeu) — google_id avec 4 photos en index.
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || './data/salons-night.db';
const db = new Database(DB_PATH);

const GID = '0x12a56245eab7cc35:0x936737fd0869f927';
const SLUG = 'test-photo-systeme';

const data = {
  nom: 'TEST Photo Système — ESPACE COIFFURE',
  ville: 'Font-Romeu-Odeillo-Via',
  google_id: GID,
};

const existing = db.prepare('SELECT id FROM salons WHERE slug = ?').get(SLUG);
if (!existing) {
  db.prepare(`
    INSERT INTO salons (slug, nom, ville, data_json, google_id, edit_token, csv_source)
    VALUES (?, ?, ?, ?, ?, ?, 'night-test')
  `).run(SLUG, data.nom, data.ville, JSON.stringify(data), GID, 'night-' + Math.random().toString(36).slice(2, 10));
  console.log('salon de test créé:', SLUG);
} else {
  db.prepare('UPDATE salons SET google_id = ? WHERE slug = ?').run(GID, SLUG);
  console.log('salon de test déjà présent:', SLUG);
}

// Un event de tracking pour que le salon apparaisse dans stats.html
const ev = db.prepare("SELECT id FROM preview_events WHERE slug = ? LIMIT 1").get(SLUG);
if (!ev) {
  db.prepare(`
    INSERT INTO preview_events (event, slug, src, ip, user_agent)
    VALUES ('preview_ouvert', ?, 'night-test', '127.0.0.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) night-test')
  `).run(SLUG);
  console.log('preview_event inséré');
}
console.log('photos indexées pour ce salon:', db.prepare('SELECT COUNT(*) AS c FROM salon_photos WHERE google_id = ?').get(GID).c);
