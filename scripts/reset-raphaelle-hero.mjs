import Database from 'better-sqlite3';
const db = new Database('/data/salons.db');

const SLUG = 'apremont-raphaelle-coiffure-holistique-energetique';

const row = db.prepare('SELECT overrides_json FROM salons WHERE slug=?').get(SLUG);
if (!row) { console.error('Salon introuvable'); process.exit(1); }

const ov = JSON.parse(row.overrides_json);
console.log('hero AVANT :', JSON.stringify(ov.hero, null, 2));

// Retire SEULEMENT backgroundImage du hero — garde tagline/title/subtitle custom.
// La page retombe alors sur le default Unsplash de styles.css (.hero { background-image: ... })
if (ov.hero && 'backgroundImage' in ov.hero) {
  delete ov.hero.backgroundImage;
  console.log('-> backgroundImage retiré');
} else {
  console.log('(pas de backgroundImage dans hero, déjà clean)');
}

console.log('hero APRÈS :', JSON.stringify(ov.hero, null, 2));

db.prepare(`
  UPDATE salons SET overrides_json=?, overrides_updated_at=datetime('now'), updated_at=datetime('now')
  WHERE slug=?
`).run(JSON.stringify(ov), SLUG);

console.log('OK');
