/**
 * Routes du parcours d'achat (signup flow) :
 *
 * - GET  /api/domain/suggestions/:slug?plan=KEY
 *     Renvoie la liste des 10 noms pré-générés × N TLDs, avec dispo + prix OVH
 *     + flag isIncluded (couvert par 1 mois d'abonnement) ou supplementEurTtc.
 *
 * - POST /api/domain/check-custom
 *     body : { slug, plan, hostname }
 *     Vérifie un hostname custom tapé par l'utilisateur.
 *
 * - POST /api/checkout/create-session
 *     body : { slug, plan, hostname, email }
 *     Crée une Stripe Checkout session avec line_items dynamiques
 *     (subscription + supplément domaine premium si nécessaire) et
 *     renvoie l'URL de redirection.
 */

import express from 'express';
import db from '../db.js';
import { checkDomainsParallel, checkDomainAvailability } from '../ovh-client.js';
import Stripe from 'stripe';

const router = express.Router();

// === Plans Stripe : doit matcher stripe_config.md ===
// Domaine TOUJOURS offert pour le client, peu importe le plan.
// On achète toujours 1 an chez OVH (P1Y). Sur le plan TWO_YEAR à 9,90€,
// le domaine .com (~9,59€) est absorbé sur le 1er mois de facturation —
// on génère du bénéfice à partir du mois 2.
const PLANS = {
  TWO_YEAR: {
    priceId: process.env.STRIPE_PRICE_2Y,
    monthlyPriceTtc: 9.90,
    label: 'Engagement 2 ans',
    commitmentMonths: 24,
    domainYears: 1,
  },
  ONE_YEAR: {
    priceId: process.env.STRIPE_PRICE_1Y,
    monthlyPriceTtc: 17.90,
    label: 'Engagement 1 an',
    commitmentMonths: 12,
    domainYears: 1,
  },
  FLEX: {
    priceId: process.env.STRIPE_PRICE_FLEX,
    monthlyPriceTtc: 29.00,
    label: 'Sans engagement',
    commitmentMonths: 0,
    domainYears: 1,
  },
};

// === TLDs candidats : ordre = priorité (le 1er disponible est sélectionné par défaut) ===
const TLD_PRIORITY = ['.fr', '.com'];

// === Seuil au-dessus duquel un domaine est considéré "premium aberrant" et
// caché des suggestions auto. Calibré sur les standards FR : .fr (~6€), .com
// (~10€), .com rare (~30€). Au-dessus de 50€ TTC/an = domaine de marque ou
// short-name premium, pas pertinent pour un coiffeur. ===
const MAX_REASONABLE_DOMAIN_PRICE_TTC = parseFloat(process.env.MAX_DOMAIN_PRICE_TTC_YR || '50');

// === Cache mémoire des résultats /api/domain/suggestions (TTL 5 min) ===
const suggestionsCache = new Map(); // key=`${slug}:${plan}` → { data, expireAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  const entry = suggestionsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expireAt) { suggestionsCache.delete(key); return null; }
  return entry.data;
}
function setCached(key, data) {
  if (suggestionsCache.size > 500) {
    // Évite la croissance infinie
    const firstKey = suggestionsCache.keys().next().value;
    if (firstKey) suggestionsCache.delete(firstKey);
  }
  suggestionsCache.set(key, { data, expireAt: Date.now() + CACHE_TTL_MS });
}

// =============================================================================
// GET /api/domain/suggestions-preview/:slug
// Réponse INSTANTANÉE : juste la liste des candidats (nom × TLD), sans check OVH.
// Permet au frontend d'afficher les noms tout de suite avec un spinner par ligne,
// pendant que /api/domain/suggestions/:slug fait les vrais checks OVH (~5-10s).
// =============================================================================
router.get('/domain/suggestions-preview/:slug', (req, res) => {
  const { slug } = req.params;
  const row = db.prepare('SELECT slug, domain_suggestions_json FROM salons WHERE slug = ?').get(slug);
  if (!row) return res.status(404).json({ error: 'Salon introuvable' });
  if (!row.domain_suggestions_json) {
    return res.status(409).json({
      error: 'Aucune suggestion pré-générée pour ce salon',
      hint: 'Lance la génération via Run actions → Suggérer noms de domaine (IA)',
    });
  }
  let names;
  try { names = JSON.parse(row.domain_suggestions_json); }
  catch { return res.status(500).json({ error: 'JSON invalide en base' }); }

  // Reconstruit la matrice nom × TLD dans le même ordre que /suggestions
  const candidates = [];
  for (const entry of names) {
    for (const tld of TLD_PRIORITY) {
      candidates.push({
        name: entry.name,
        tld,
        hostname: `${entry.name}${tld}`,
        rank: entry.rank,
        available: null,           // pas encore checké
        isIncluded: null,
      });
    }
  }
  res.json({ slug, suggestions: candidates });
});

// =============================================================================
// GET /api/domain/suggestions/:slug
// =============================================================================
router.get('/domain/suggestions/:slug', async (req, res) => {
  const { slug } = req.params;
  const planKey = String(req.query.plan || 'TWO_YEAR').toUpperCase();
  const plan = PLANS[planKey];
  if (!plan) return res.status(400).json({ error: 'plan invalide' });

  const cacheKey = `${slug}:${planKey}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const row = db.prepare('SELECT slug, domain_suggestions_json FROM salons WHERE slug = ?').get(slug);
  if (!row) return res.status(404).json({ error: 'Salon introuvable' });
  if (!row.domain_suggestions_json) {
    return res.status(409).json({
      error: 'Aucune suggestion pré-générée pour ce salon',
      hint: 'Lance la génération via Run actions → Suggérer noms de domaine (IA)',
    });
  }

  let names;
  try { names = JSON.parse(row.domain_suggestions_json); }
  catch { return res.status(500).json({ error: 'JSON invalide en base' }); }

  // On construit la matrice nom × TLD
  const candidates = [];
  for (const entry of names) {
    for (const tld of TLD_PRIORITY) {
      candidates.push({ name: entry.name, tld, rank: entry.rank });
    }
  }

  // Check OVH en parallèle (8 concurrent max — large sous le rate limit 60/min)
  let results;
  try {
    results = await checkDomainsParallel(candidates, { concurrency: 8 });
  } catch (err) {
    console.error('[/api/domain/suggestions] OVH error:', err.message);
    return res.status(502).json({ error: 'Service OVH indisponible, réessayez dans 1 minute' });
  }

  // On garde TOUS les résultats : dispos ET pris.
  // Le frontend affichera une pastille "Disponible" / "Pris" pour chacun.
  // Seul filtre côté serveur : on enlève les domaines premium aberrants
  // (priceEurTtc > MAX_REASONABLE_DOMAIN_PRICE_TTC, ex: salon32.com 2777€).
  let droppedPremium = 0;
  const enriched = results.map(r => {
    if (r.available && r.priceEurTtc != null && r.priceEurTtc > MAX_REASONABLE_DOMAIN_PRICE_TTC) {
      droppedPremium++;
      return null;
    }
    return {
      hostname: r.hostname,
      name: r.name,
      tld: r.tld,
      rank: candidates.find(c => c.name === r.name && c.tld === r.tld)?.rank || 999,
      available: !!r.available,
      reason: r.available ? null : (r.reason || 'unavailable'),
      priceEurHt: r.priceEurHt,
      priceEurTtc: r.priceEurTtc,
      isPremium: r.isPremium,
      isIncluded: !!r.available,    // si dispo, toujours offert
      supplementEurTtc: 0,
    };
  }).filter(Boolean);

  // Sort : disponibles en premier, puis rank GPT croissant, puis .fr en priorité
  enriched.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    const tldRank = (t) => TLD_PRIORITY.indexOf(t);
    return tldRank(a.tld) - tldRank(b.tld);
  });

  const payload = {
    slug,
    plan: { key: planKey, label: plan.label, monthlyPriceTtc: plan.monthlyPriceTtc },
    suggestions: enriched,
    totalCheckedAvailable: enriched.filter(s => s.available).length,
    totalChecked: candidates.length,
    droppedPremium, // domaines premium aberrants exclus
    maxReasonablePriceTtc: MAX_REASONABLE_DOMAIN_PRICE_TTC,
  };
  setCached(cacheKey, payload);
  res.json(payload);
});

// =============================================================================
// POST /api/domain/check-custom
// =============================================================================
router.post('/domain/check-custom', express.json(), async (req, res) => {
  const { slug, plan: planKey, hostname: rawHostname } = req.body || {};
  if (!slug || !planKey || !rawHostname) {
    return res.status(400).json({ error: 'slug, plan, hostname requis' });
  }
  const plan = PLANS[String(planKey).toUpperCase()];
  if (!plan) return res.status(400).json({ error: 'plan invalide' });

  // Normalise le hostname custom
  let hostname = String(rawHostname).trim().toLowerCase();
  // Retire un éventuel http:// https:// www.
  hostname = hostname.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  // Si pas d'extension, on essaie .fr d'abord
  if (!hostname.includes('.')) hostname = `${hostname}.fr`;
  // Validation simple (RFC 1123 simplifié)
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostname)) {
    return res.status(400).json({ error: 'Nom invalide. Caractères autorisés : a-z, 0-9, tirets et 1 point pour l\'extension.' });
  }
  if (hostname.length > 253) {
    return res.status(400).json({ error: 'Nom trop long (max 253 caractères)' });
  }

  let check;
  try {
    check = await checkDomainAvailability(hostname);
  } catch (err) {
    return res.status(502).json({ error: 'Service OVH indisponible, réessayez dans 1 minute' });
  }

  // Filtre business : on n'accepte que .fr et .com avec prix raisonnable.
  // Tout le reste est rejeté pour cohérence avec les suggestions auto.
  const isAllowedTld = /\.(fr|com)$/i.test(hostname);
  const isReasonablePrice = check.priceEurTtc == null || check.priceEurTtc <= MAX_REASONABLE_DOMAIN_PRICE_TTC;
  const accepted = check.available && isAllowedTld && isReasonablePrice;

  res.json({
    hostname,
    available: accepted,                            // false si pris OU TLD non autorisé OU trop cher
    priceEurHt: check.priceEurHt,
    priceEurTtc: check.priceEurTtc,
    isPremium: check.isPremium,
    isIncluded: accepted,                           // si dispo et autorisé → toujours offert
    supplementEurTtc: 0,
    plan: { key: planKey, monthlyPriceTtc: plan.monthlyPriceTtc },
    reason: !check.available ? (check.reason || 'unavailable')
          : !isAllowedTld ? 'tld_not_allowed'
          : !isReasonablePrice ? 'price_too_high'
          : null,
  });
});

// =============================================================================
// POST /api/checkout/create-session
// =============================================================================
router.post('/checkout/create-session', express.json(), async (req, res) => {
  const { slug, plan: planKey, hostname, email } = req.body || {};
  if (!slug || !planKey || !hostname || !email) {
    return res.status(400).json({ error: 'slug, plan, hostname, email requis' });
  }
  const plan = PLANS[String(planKey).toUpperCase()];
  if (!plan) return res.status(400).json({ error: 'plan invalide' });
  if (!plan.priceId) return res.status(500).json({ error: 'STRIPE_PRICE_* env vars non configurés' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY non configuré' });

  // Vérifie que le salon existe + récupère le plan tarifaire pour stocker le contexte
  const salon = db.prepare('SELECT id, slug, nom, nom_clean, ville FROM salons WHERE slug = ?').get(slug);
  if (!salon) return res.status(404).json({ error: 'Salon introuvable' });

  // Refais un check final OVH du domain (au cas où il aurait été pris entre-temps)
  let check;
  try {
    check = await checkDomainAvailability(hostname);
  } catch (err) {
    return res.status(502).json({ error: 'Service OVH indisponible' });
  }
  if (!check.available) {
    return res.status(409).json({ error: 'Ce domaine n\'est plus disponible. Choisissez-en un autre.' });
  }
  // Filtre TLD + prix : on accepte uniquement .fr et .com sous le seuil
  const isAllowedTld = /\.(fr|com)$/i.test(hostname);
  if (!isAllowedTld) {
    return res.status(400).json({ error: 'Seules les extensions .fr et .com sont supportées.' });
  }
  if (check.priceEurTtc != null && check.priceEurTtc > MAX_REASONABLE_DOMAIN_PRICE_TTC) {
    return res.status(400).json({ error: 'Ce domaine est en tarif premium, choisissez-en un autre.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  // line_items : juste l'abonnement. Le domaine est offert (1 an), absorbé sur la marge.
  const lineItems = [{ price: plan.priceId, quantity: 1 }];

  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://monsitehq.com';
  const successUrl = `${baseUrl}/preview/${slug}?signup=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}/preview/${slug}?signup=cancelled`;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: lineItems,
      subscription_data: {
        metadata: {
          slug,
          hostname,
          plan: planKey,
          commitment_months: String(plan.commitmentMonths),
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      locale: 'fr',
      payment_method_types: ['card'],
      metadata: { slug, hostname, plan: planKey },
    });
  } catch (err) {
    console.error('[/api/checkout/create-session] Stripe error:', err.message);
    return res.status(500).json({ error: 'Erreur de création de session de paiement: ' + err.message });
  }

  // On stocke la signup_session_id sur le salon pour pouvoir tracker
  db.prepare(`
    UPDATE salons
    SET signup_session_id = ?, owner_email = ?, plan = ?, live_hostname = ?,
        commitment_months = ?, subscription_status = 'pending', updated_at = datetime('now')
    WHERE slug = ?
  `).run(session.id, email, planKey, hostname, plan.commitmentMonths, slug);

  res.json({ url: session.url, sessionId: session.id });
});

// =============================================================================
// GET /api/signup/status?session_id=cs_xxx OU ?slug=xxx
// =============================================================================
// Endpoint léger appelé par la waiting screen post-paiement Stripe.
// Renvoie l'état actuel du provisioning : pending / provisioning / live / error.
router.get('/signup/status', (req, res) => {
  const slug = req.query.slug;
  const sessionId = req.query.session_id;
  if (!slug && !sessionId) {
    return res.status(400).json({ error: 'slug ou session_id requis' });
  }
  let row;
  if (slug) {
    row = db.prepare(`
      SELECT slug, subscription_status, live_hostname, owner_email, plan, signed_up_at
      FROM salons WHERE slug = ?
    `).get(slug);
  } else {
    row = db.prepare(`
      SELECT slug, subscription_status, live_hostname, owner_email, plan, signed_up_at
      FROM salons WHERE signup_session_id = ?
    `).get(sessionId);
  }
  if (!row) return res.status(404).json({ error: 'Inconnu' });
  res.json({
    slug: row.slug,
    status: row.subscription_status || 'pending',
    liveHostname: row.live_hostname,
    plan: row.plan,
    signedUpAt: row.signed_up_at,
  });
});

export default router;
