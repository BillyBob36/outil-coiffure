// Valeurs par defaut + services standards de coiffure
// Tout est ecrasable par les overrides du coiffeur

export const DEFAULT_GALLERY_IMAGES = [
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&q=80',
  'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&q=80',
  'https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=800&q=80',
  'https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?w=800&q=80',
  'https://images.unsplash.com/photo-1634449571010-02389ed0f9b0?w=800&q=80',
  'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=800&q=80'
];

export const DEFAULT_HERO_IMAGE = 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1920&q=80';

export const DEFAULT_SERVICES = [
  { id: 's1', name: 'Coupe Femme', description: 'Coupe personnalisee femme : shampoing, coupe, finition.', price: '35€' },
  { id: 's2', name: 'Coupe Homme', description: 'Coupe homme classique ou tendance, finition incluse.', price: '22€' },
  { id: 's3', name: 'Coupe Enfant', description: 'Coupe enfant (jusqu\'a 12 ans).', price: '18€' },
  { id: 's4', name: 'Shampoing & Brushing', description: 'Lavage, soin et mise en forme.', price: '25€' },
  { id: 's5', name: 'Brushing seul', description: 'Mise en forme cheveux propres.', price: '20€' },
  { id: 's6', name: 'Coloration', description: 'Coloration couvrante, ton sur ton ou couleur d\'envie.', price: '55€' },
  { id: 's7', name: 'Meches / Balayage', description: 'Eclaircissement sur mesure pour donner du relief.', price: '75€' },
  { id: 's8', name: 'Soin profond', description: 'Soin reparateur et hydratant en profondeur.', price: '30€' },
  { id: 's9', name: 'Coiffure Mariage', description: 'Coiffure d\'exception pour le jour J (essai inclus).', price: '90€' },
  { id: 's10', name: 'Lissage', description: 'Lissage professionnel pour cheveux soyeux et disciplines.', price: '80€' }
];

export const DEFAULT_TESTIMONIALS = [
  { id: 't1', text: 'Une experience top du debut a la fin. L\'equipe est aux petits soins, l\'ecoute est reelle et le resultat sublime ! Je recommande sans hesiter.', author: 'Marie L.', date: 'Il y a quelques semaines' },
  { id: 't2', text: 'Je n\'avais jamais ete aussi satisfaite d\'un salon. Coupe parfaite, ambiance chaleureuse et conseils personnalises. C\'est devenu mon adresse !', author: 'Sophie D.', date: 'Il y a 1 mois' },
  { id: 't3', text: 'Accueil au top, professionnalisme exemplaire et tarifs honnetes. Mes cheveux n\'ont jamais ete aussi beaux. Merci a toute l\'equipe pour ce moment !', author: 'Julie M.', date: 'Il y a quelques jours' }
];

export const DEFAULT_INTRO_FALLBACK = 'Une equipe passionnee a votre ecoute pour des prestations de qualite, dans une ambiance conviviale.';

// Detecte automatiquement une URL de reservation en ligne specifique au salon
// dans les colonnes du CSV (Planity, Booksy, Reservio, Cituro, Settime, Treatwell)
export function detectBookingUrl(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname || '/';

  // Sous-domaine sur une plateforme (toujours specifique au salon)
  const subdomainPlatforms = ['booksy.com', 'site-solocal.com'];
  for (const p of subdomainPlatforms) {
    if (host.endsWith('.' + p) && host !== p) return rawUrl;
  }

  // Plateforme racine + path significatif (= page specifique du salon)
  const rootPlatforms = [
    'planity.com', 'reservio.com', 'cituro.com',
    'settime.io', 'book.settime.io', 'app.cituro.com',
    'treatwell.fr', 'treatwell.com', 'treatwell.de',
    'rdv360.com', 'merci-yanis.com'
  ];
  for (const p of rootPlatforms) {
    if (host === p && path.length > 1 && !['/login', '/'].includes(path)) {
      return rawUrl;
    }
  }
  return null;
}

const ACCENT_MAP = {
  'à':'a','á':'a','â':'a','ä':'a','é':'e','è':'e','ê':'e','ë':'e','î':'i','ï':'i','ô':'o','ö':'o','ù':'u','û':'u','ü':'u','ÿ':'y','ç':'c','ñ':'n'
};
function deburr(s) {
  return String(s || '').toLowerCase().replace(/[àáâäéèêëîïôöùûüÿçñ]/g, ch => ACCENT_MAP[ch] || ch);
}

// Genere des defauts contextualises a partir des donnees CSV brutes
export function buildDefaults(csvData) {
  const nom = csvData.nom || 'Salon de coiffure';
  const ville = csvData.ville || '';
  const note = parseFloat(csvData.note_avis);
  const showRating = Number.isFinite(note) && note >= 4;

  return {
    hero: {
      title: nom,
      tagline: 'Bienvenue chez',
      subtitle: ville ? `Salon de coiffure a ${ville}` : 'Votre coiffeur de proximite',
      backgroundImage: DEFAULT_HERO_IMAGE,
      showRating
    },
    intro: {
      title: ville ? `Bienvenue à ${ville}` : 'Bienvenue',
      description: csvData.meta_description || `Notre equipe vous accueille ${ville ? `a ${ville} ` : ''}pour vous offrir des prestations de coiffure soignees dans une ambiance chaleureuse. Nous mettons notre savoir-faire au service de votre style.`,
      showRating,
      ratingFallback: 'Une qualite de service reconnue par nos clients fideles, jour apres jour.',
      showSatisfaction: true,
      satisfactionValue: '100%',
      satisfactionLabel: 'Satisfaction'
    },
    services: {
      title: 'Nos Services',
      items: DEFAULT_SERVICES.slice()
    },
    gallery: {
      title: 'Galerie',
      layout: 'grid', // 'grid' | 'masonry'
      images: DEFAULT_GALLERY_IMAGES.slice(),
      visibleCount: 6
    },
    testimonials: {
      title: 'Avis Clients',
      items: DEFAULT_TESTIMONIALS.slice()
    },
    contact: {
      title: 'Venez nous rendre visite',
      description: `Notre equipe vous accueille pour tous vos besoins en coiffure${ville ? ` a ${ville}` : ''}.`,
      address: csvData.adresse || '',
      addressLine2: csvData.code_postal && csvData.ville ? `${csvData.code_postal} ${csvData.ville}` : (csvData.code_postal || csvData.ville || ''),
      phone: csvData.telephone || '',
      email: csvData.email || '',
      hours: csvData.heures_ouverture || null,
      latitude: csvData.latitude,
      longitude: csvData.longitude,
      bookingUrl: detectBookingUrl(csvData.site_internet_original) || ''
    },
    socials: {
      facebook: { url: csvData.lien_facebook || '', enabled: !!csvData.lien_facebook },
      instagram: { url: csvData.lien_instagram || '', enabled: !!csvData.lien_instagram },
      tiktok: { url: csvData.lien_tiktok || '', enabled: !!csvData.lien_tiktok },
      youtube: { url: csvData.lien_youtube || '', enabled: !!csvData.lien_youtube }
    }
  };
}

// Merge profond : overrides ecrase defaults, mais garde les cles non touchees
export function mergeOverrides(defaults, overrides) {
  if (!overrides || typeof overrides !== 'object') return defaults;
  const out = JSON.parse(JSON.stringify(defaults));

  for (const section of Object.keys(overrides)) {
    if (overrides[section] === null || overrides[section] === undefined) continue;
    if (section === 'services' || section === 'gallery' || section === 'testimonials' || section === 'socials') {
      // Pour ces sections, on remplace completement la section si overridee
      out[section] = { ...out[section], ...overrides[section] };
    } else if (typeof overrides[section] === 'object') {
      out[section] = { ...out[section], ...overrides[section] };
    } else {
      out[section] = overrides[section];
    }
  }

  return out;
}

// Construit la version finale (defaults + overrides) a partir des donnees DB
export function buildSalonView(salonRow) {
  let csvData = {};
  try { csvData = JSON.parse(salonRow.data_json || '{}'); } catch {}
  let hours = null;
  try { hours = salonRow.heures_ouverture ? JSON.parse(salonRow.heures_ouverture) : null; } catch {}

  // Nom affiche : nom_clean s'il existe, sinon nom brut du CSV
  const displayName = (salonRow.nom_clean && salonRow.nom_clean.trim()) || salonRow.nom;

  // Enrichissement avec les colonnes typees
  const flat = {
    ...csvData,
    nom: displayName,
    ville: salonRow.ville,
    code_postal: salonRow.code_postal,
    adresse: salonRow.adresse,
    telephone: salonRow.telephone,
    email: salonRow.email,
    latitude: salonRow.latitude,
    longitude: salonRow.longitude,
    note_avis: salonRow.note_avis,
    nb_avis: salonRow.nb_avis,
    heures_ouverture: hours,
    lien_facebook: salonRow.lien_facebook,
    lien_instagram: salonRow.lien_instagram,
    lien_tiktok: salonRow.lien_tiktok,
    lien_youtube: salonRow.lien_youtube,
    lien_google_maps: salonRow.lien_google_maps,
    meta_image: salonRow.meta_image,
    meta_description: salonRow.meta_description
  };

  const defaults = buildDefaults(flat);

  let overrides = null;
  try { overrides = salonRow.overrides_json ? JSON.parse(salonRow.overrides_json) : null; } catch {}

  return {
    slug: salonRow.slug,
    nom: displayName,
    nom_original: salonRow.nom,
    ville: salonRow.ville,
    note_avis: salonRow.note_avis,
    nb_avis: salonRow.nb_avis,
    lien_google_maps: salonRow.lien_google_maps,
    meta_description: salonRow.meta_description,
    content: mergeOverrides(defaults, overrides),
    has_overrides: !!overrides
  };
}
