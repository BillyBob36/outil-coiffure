import Database from 'better-sqlite3';
const db = new Database('/data/salons.db', { readonly: true });

const rows = db.prepare(`
  SELECT slug, nom, ville, overrides_json, overrides_updated_at, data_json
  FROM salons
  WHERE LOWER(nom) LIKE LOWER('%rapha%')
  LIMIT 5
`).all();

console.log('Matches:', rows.length);
for (const r of rows) {
  console.log('---');
  console.log('slug:', r.slug);
  console.log('nom :', r.nom);
  console.log('ville:', r.ville);
  console.log('overrides_updated_at:', r.overrides_updated_at);
  if (r.overrides_json) {
    try {
      const ov = JSON.parse(r.overrides_json);
      const keys = Object.keys(ov);
      console.log('overrides keys:', keys);
      // Affiche tout ce qui ressemble à une image
      for (const k of keys) {
        if (/hero|bg|background|image|photo/i.test(k)) {
          console.log('  ', k, '=', JSON.stringify(ov[k]).slice(0, 200));
        }
      }
    } catch (e) { console.log('overrides parse err:', e.message); }
  } else {
    console.log('overrides_json: (null)');
  }
}
