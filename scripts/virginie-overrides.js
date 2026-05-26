// Override personnalisé pour Virginie Garcia (L'Hair du Temps, Chasselay)
// Coiffeuse à domicile. Cf. /scripts/virginie-overrides.js — exécution manuelle
// via : docker exec <helsinki-container> node /tmp/virginie-overrides.js
//
// NE PAS supprimer ce fichier — il sert de référence pour les futurs cas similaires
// (= autres coiffeurs à domicile à adapter manuellement en attendant que l'UI
// "type d'activité" soit utilisée par les coiffeurs eux-mêmes via leur admin).

const Database = require('better-sqlite3');
const db = new Database('/data/salons.db');

const SLUG = 'chasselay-l-hair-du-temps';

const overrides = {
  hero: {
    tagline: 'Coiffeuse à domicile',
    subtitle: 'Je me déplace chez vous à Chasselay et alentours',
  },
  intro: {
    title: 'Une coiffeuse à domicile, rien que pour vous',
    description: "À Chasselay et dans un rayon de 30 km, je me déplace chez vous pour des prestations entièrement personnalisées : coupe, coloration, mèches, événements (mariage, soirée…). Je m'occupe aussi des personnes à mobilité réduite et des résidents d'EHPAD. Un seul rendez-vous, un service VIP — sans déplacement de votre côté.",
  },
  services: {
    title: 'Mes prestations à domicile',
    items: [
      { id: 's1', name: 'Coupe Femme à domicile', description: 'Shampoing, coupe et finition, dans le confort de votre domicile.', price: '40€' },
      { id: 's2', name: 'Coupe Homme à domicile', description: 'Coupe homme classique ou tendance, finition incluse, à domicile.', price: '25€' },
      { id: 's3', name: 'Coupe Enfant à domicile', description: "Coupe enfant (jusqu'à 12 ans), à domicile.", price: '20€' },
      { id: 's4', name: 'Coloration à domicile', description: "Coloration couvrante, ton sur ton ou couleur d'envie — chez vous.", price: '60€' },
      { id: 's5', name: 'Mèches / Balayage à domicile', description: 'Éclaircissement sur mesure, à domicile.', price: '85€' },
      { id: 's6', name: 'Brushing à domicile', description: 'Mise en forme à domicile sur cheveux propres.', price: '25€' },
      { id: 's7', name: 'Coiffure Mariage à domicile', description: "Coiffure d'exception le jour J (essai inclus).", price: '100€' },
      { id: 's8', name: 'Coiffure événement / soirée', description: 'Mise en plis ou attache pour soirée, gala, communion…', price: '55€' },
      { id: 's9', name: 'Soins seniors / EHPAD', description: 'Coupe et soin à domicile ou en EHPAD — tarif spécifique.', price: 'Sur demande' },
    ],
  },
  gallery: {
    title: 'Mes réalisations',
  },
  contact: {
    mode: 'zone',
    serviceArea: "Chasselay et 30 km autour : Lyon Nord, Limonest, Anse, Quincieux, Civrieux d'Azergues",
    // hideMap: false (défaut) → carte visible, centrée sur la ville Chasselay
    // sans adresse précise (protection vie privée + visualisation de la zone)
    hideMap: false,
    title: 'Prenons rendez-vous',
    description: 'Je me déplace chez vous pour toutes vos envies coiffure. Contactez-moi pour réserver votre créneau.',
  },
};

const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
const r = db.prepare('UPDATE salons SET overrides_json=?, updated_at=? WHERE slug=?').run(
  JSON.stringify(overrides),
  now,
  SLUG
);
console.log('Rows updated:', r.changes);

const after = db.prepare('SELECT overrides_json FROM salons WHERE slug=?').get(SLUG);
console.log('AFTER (first 300 chars):', after.overrides_json.substring(0, 300), '...');
