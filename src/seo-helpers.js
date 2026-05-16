/**
 * Helpers SEO pour le rendu serveur (SSR) des pages salon.
 *
 * Génère :
 *   - <title>, <meta description>, canonical, Open Graph, Twitter Card
 *   - JSON-LD HairSalon (rich results Google : étoiles, horaires, prix)
 *   - Helpers de formatage (escapeHtml, weekday → schema.org day enum)
 *
 * Toutes les fonctions sont pures : (view, options) → string. Idempotentes.
 */

// =============================================================================
// Helpers de base
// =============================================================================

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return s == null ? '' : String(s).replace(/[&<>"']/g, c => HTML_ESCAPE_MAP[c]);
}

/**
 * Tronque une chaîne à `max` caractères, en respectant les frontières de mot
 * (pas de troncage au milieu d'un mot) + "…" final si tronqué.
 */
function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  const sliced = s.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? sliced.slice(0, lastSpace) : sliced).trimEnd() + '…';
}

// Mapping FR jours → Schema.org enum DayOfWeek
const DAY_FR_TO_SCHEMA = {
  lundi: 'Monday', mardi: 'Tuesday', mercredi: 'Wednesday', jeudi: 'Thursday',
  vendredi: 'Friday', samedi: 'Saturday', dimanche: 'Sunday'
};

// =============================================================================
// Title + Description
// =============================================================================

/**
 * Title SEO : "{Nom} — Coiffeur à {Ville} | Prendre RDV" (max 60 chars)
 * Si pas de ville : "{Nom} — Salon de coiffure | Prendre RDV"
 */
export function generateTitle(view) {
  const nom = (view.nom || 'Salon de coiffure').trim();
  const ville = (view.ville || '').trim();
  const base = ville ? `${nom} — Coiffeur à ${ville}` : `${nom} — Salon de coiffure`;
  const suffix = ' | Prendre RDV';
  // Cap à ~62 chars (tolérance Google)
  if (base.length + suffix.length <= 62) return base + suffix;
  return truncate(base, 62);
}

/**
 * Meta description : 150-160 chars unique par salon.
 * Combine nom + ville + 1-2 services phares + CTA.
 */
export function generateMetaDescription(view) {
  const c = view.content || {};
  const nom = (view.nom || 'notre salon').trim();
  const ville = (view.ville || '').trim();
  const note = view.note_avis;
  const nbAvis = view.nb_avis;

  // Tente d'utiliser la description scrappée/IA en priorité, tronquée
  const introDesc = (c.intro && c.intro.description) || '';
  if (introDesc && introDesc.length >= 80) {
    return truncate(introDesc.replace(/\s+/g, ' ').trim(), 158);
  }

  // Fallback : génère à partir des services + ville + note
  const services = (c.services && Array.isArray(c.services.items)) ? c.services.items : [];
  const topServices = services.slice(0, 3).map(s => s.name || s.title).filter(Boolean).join(', ');

  const parts = [];
  parts.push(`${nom} — coiffeur${ville ? ` à ${ville}` : ''}.`);
  if (topServices) parts.push(`${topServices}.`);
  if (note && nbAvis) parts.push(`★ ${note}/5 (${nbAvis} avis Google).`);
  parts.push('Prenez rendez-vous en ligne.');

  return truncate(parts.join(' '), 158);
}

// =============================================================================
// JSON-LD HairSalon
// =============================================================================

/**
 * Convertit un objet horaires {lundi: "9h - 18h", mardi: "Fermé", ...} en
 * tableau d'OpeningHoursSpecification Schema.org.
 * Format input attendu : { lundi: "9h - 18h, 14h - 19h" } ou { lundi: "Fermé" }
 */
function buildOpeningHoursSpec(hours) {
  if (!hours || typeof hours !== 'object') return [];
  const specs = [];
  for (const [dayFr, value] of Object.entries(hours)) {
    const dayOfWeek = DAY_FR_TO_SCHEMA[dayFr.toLowerCase()];
    if (!dayOfWeek) continue;
    if (!value || /ferm/i.test(value)) continue;
    // Parse "9h - 18h" ou "9h - 12h, 14h - 19h"
    const ranges = String(value).split(',').map(r => r.trim());
    for (const range of ranges) {
      const m = range.match(/(\d{1,2})\s*h\s*(\d{0,2})\s*[-–à]\s*(\d{1,2})\s*h\s*(\d{0,2})/i);
      if (!m) continue;
      const opens = `${String(m[1]).padStart(2, '0')}:${(m[2] || '00').padStart(2, '0')}`;
      const closes = `${String(m[3]).padStart(2, '0')}:${(m[4] || '00').padStart(2, '0')}`;
      specs.push({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${dayOfWeek}`,
        opens,
        closes,
      });
    }
  }
  return specs;
}

/**
 * priceRange : convention Schema.org = "$" / "$$" / "$$$".
 * On déduit du prix moyen des services. Pour un coiffeur français moyen :
 *   < 30€ → $ ; 30-60€ → $$ ; > 60€ → $$$
 */
function inferPriceRange(services) {
  if (!Array.isArray(services) || services.length === 0) return '€€';
  const prices = services
    .map(s => parseFloat(String(s.price || s.prix || '').replace(',', '.').replace(/[^\d.]/g, '')))
    .filter(p => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return '€€';
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (avg < 30) return '€';
  if (avg < 60) return '€€';
  return '€€€';
}

/**
 * Génère le JSON-LD complet HairSalon pour un salon.
 * @param {Object} view - résultat de buildSalonView()
 * @param {Object} options - { siteUrl: 'https://salon-jean.fr', logoUrl?: '...' }
 * @returns {string} JSON-LD prêt à être injecté dans <script type="application/ld+json">
 */
export function generateJsonLd(view, options = {}) {
  const c = view.content || {};
  const contact = c.contact || {};
  const hero = c.hero || {};
  const services = (c.services && Array.isArray(c.services.items)) ? c.services.items : [];
  const siteUrl = (options.siteUrl || 'https://maquickpage.fr').replace(/\/$/, '');

  const data = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': `${siteUrl}/#business`,
    name: view.nom || 'Salon de coiffure',
    url: siteUrl,
    image: hero.backgroundImage || options.logoUrl || `${siteUrl}/screenshots/${view.slug}.jpg`,
    priceRange: inferPriceRange(services),
  };

  if (contact.phone) data.telephone = String(contact.phone).replace(/\s+/g, ' ').trim();
  if (contact.email) data.email = contact.email;

  // Adresse
  if (contact.address || view.ville) {
    const postalAndCity = (contact.addressLine2 || '').trim();
    let postalCode = '', city = view.ville || '';
    const m = postalAndCity.match(/^(\d{5})\s+(.+)$/);
    if (m) { postalCode = m[1]; city = m[2]; }
    data.address = {
      '@type': 'PostalAddress',
      streetAddress: contact.address || '',
      addressLocality: city,
      postalCode,
      addressCountry: 'FR',
    };
  }

  // Géolocalisation (lat/lng)
  if (Number.isFinite(parseFloat(contact.latitude)) && Number.isFinite(parseFloat(contact.longitude))) {
    data.geo = {
      '@type': 'GeoCoordinates',
      latitude: parseFloat(contact.latitude),
      longitude: parseFloat(contact.longitude),
    };
  }

  // Horaires d'ouverture
  const hoursSpec = buildOpeningHoursSpec(contact.hours);
  if (hoursSpec.length > 0) data.openingHoursSpecification = hoursSpec;

  // Note Google si dispo
  const note = parseFloat(view.note_avis);
  const nbAvis = parseInt(String(view.nb_avis || '').replace(/\D/g, ''), 10);
  if (Number.isFinite(note) && note > 0 && Number.isFinite(nbAvis) && nbAvis > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: note,
      reviewCount: nbAvis,
      bestRating: 5,
      worstRating: 1,
    };
  }

  // Services (en tant qu'OfferCatalog)
  if (services.length > 0) {
    data.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Prestations',
      itemListElement: services.slice(0, 20).map((s, i) => ({
        '@type': 'Offer',
        position: i + 1,
        itemOffered: {
          '@type': 'Service',
          name: s.name || s.title || `Service ${i + 1}`,
          ...(s.description ? { description: s.description } : {}),
        },
        ...(s.price || s.prix ? { price: String(s.price || s.prix).replace(',', '.').replace(/[^\d.]/g, ''), priceCurrency: 'EUR' } : {}),
      })),
    };
  }

  // sameAs : profils sociaux + Google Maps
  const sameAs = [];
  if (view.lien_google_maps) sameAs.push(view.lien_google_maps);
  if (c.socials) {
    for (const platform of ['facebook', 'instagram', 'tiktok', 'youtube']) {
      const s = c.socials[platform];
      if (s && s.enabled && s.url) sameAs.push(s.url);
    }
  }
  if (sameAs.length > 0) data.sameAs = sameAs;

  return JSON.stringify(data);
}

// =============================================================================
// Open Graph + Twitter Card
// =============================================================================

export function generateOgTags(view, options = {}) {
  const siteUrl = (options.siteUrl || 'https://maquickpage.fr').replace(/\/$/, '');
  const title = options.title || generateTitle(view);
  const description = options.description || generateMetaDescription(view);
  const image = (view.content && view.content.hero && view.content.hero.backgroundImage)
    || `${siteUrl}/screenshots/${view.slug}.jpg`;

  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta property="og:site_name" content="${escapeHtml(view.nom || 'MaQuickPage')}">`,
    `<meta property="og:url" content="${escapeHtml(siteUrl + '/')}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
  ].join('\n  ');
}

export default {
  escapeHtml,
  generateTitle,
  generateMetaDescription,
  generateJsonLd,
  generateOgTags,
};
