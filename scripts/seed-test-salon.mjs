/**
 * Insère un salon factice "Salon Test MaQuickPage" pour les tests E2E.
 *
 * Pré-rempli avec des données réalistes mais clairement de TEST. Slug stable
 * pour pouvoir relancer le script (idempotent).
 *
 * Usage : EMAIL=xxx@yyy.com node scripts/seed-test-salon.mjs
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const SLUG = 'salon-test-maquickpage';
const EMAIL = process.env.EMAIL || 'johann.metagora@gmail.com';

const db = new Database('/data/salons.db');
const token = crypto.randomBytes(8).toString('hex');

const exists = db.prepare('SELECT slug FROM salons WHERE slug=?').get(SLUG);
if (exists) {
  db.prepare(`
    UPDATE salons
    SET email=?, owner_email=?, edit_token=?, subscription_status=NULL,
        live_hostname=NULL, stripe_customer_id=NULL, stripe_subscription_id=NULL,
        updated_at=datetime('now')
    WHERE slug=?
  `).run(EMAIL, EMAIL, token, SLUG);
  console.log('Salon existant — réinitialisé pour test E2E');
} else {
  const dataJson = JSON.stringify({
    nom: 'Salon Test MaQuickPage',
    ville: 'Paris',
    adresse: '61 rue de Lyon, 75012 Paris',
    telephone: '+33 1 23 45 67 89',
    horaires: {
      lundi: '9h–19h', mardi: '9h–19h', mercredi: '9h–19h',
      jeudi: '9h–19h', vendredi: '9h–19h', samedi: '9h–18h', dimanche: 'Fermé',
    },
    prestations: [
      { nom: 'Coupe femme', prix: '35€' },
      { nom: 'Coupe homme', prix: '22€' },
      { nom: 'Couleur', prix: 'à partir de 55€' },
      { nom: 'Brushing', prix: '28€' },
    ],
  });
  db.prepare(`
    INSERT INTO salons (
      slug, nom, nom_clean, ville, code_postal, adresse, telephone, email, owner_email,
      note_avis, nb_avis, titre_site, meta_description, data_json, edit_token, csv_source
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    SLUG,
    'Salon Test MaQuickPage',
    'Salon Test',
    'Paris',
    '75012',
    '61 rue de Lyon, 75012 Paris',
    '+33 1 23 45 67 89',
    EMAIL,
    EMAIL,
    4.8,
    '142',
    'Salon Test MaQuickPage — Coiffeur Paris 12',
    'Salon de test pour les démos MaQuickPage. Coiffure femme, homme et enfant à Paris 12e.',
    dataJson,
    token,
    'fixture-test'
  );
  console.log('Salon test inséré');
}

const row = db.prepare(`
  SELECT slug, nom, email, owner_email, edit_token, subscription_status, live_hostname
  FROM salons WHERE slug=?
`).get(SLUG);
console.log(JSON.stringify(row, null, 2));
console.log('');
console.log('URLs utiles :');
console.log('  Demo public  : https://maquickpage.fr/preview/' + SLUG);
console.log('  Admin coif.  : https://maquickpage.fr/admin/' + SLUG + '?token=' + row.edit_token);
console.log('  Admin agency : https://outil.maquickpage.fr/admin/salons/' + SLUG);
