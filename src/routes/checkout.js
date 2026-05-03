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
const PLANS = {
  TWO_YEAR: {
    priceId: process.env.STRIPE_PRICE_2Y,
    monthlyPriceTtc: 9.90,
    label: 'Engagement 2 ans',
    commitmentMonths: 24,
  },
  ONE_YEAR: {
    priceId: process.env.STRIPE_PRICE_1Y,
    monthlyPriceTtc: 17.90,
    label: 'Engagement 1 an',
    commitmentMonths: 12,
  },
  FLEX: {
    priceId: process.env.STRIPE_PRICE_FLEX,
    monthlyPriceTtc: 29.00,
    label: 'Sans engagement',
    commitmentMonths: 0,
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

  // Enrichi avec isIncluded + supplementEurTtc
  // Filtre :
  //   - drops les indisponibles
  //   - drops les domaines au-dessus de MAX_REASONABLE_DOMAIN_PRICE_TTC (premium
  //     aberrant non pertinent pour un coiffeur)
  let droppedPremium = 0;
  const enriched = results.map(r => {
    if (!r.available) return null;
    if (r.priceEurTtc != null && r.priceEurTtc > MAX_REASONABLE_DOMAIN_PRICE_TTC) {
      droppedPremium++;
      return null;
    }
    const isIncluded = r.priceEurTtc != null && r.priceEurTtc <= plan.monthlyPriceTtc;
    const supplementEurTtc = isIncluded ? 0 : Math.max(0, Math.round((r.priceEurTtc - plan.monthlyPriceTtc) * 100) / 100);
    return {
      hostname: r.hostname,
      name: r.name,
      tld: r.tld,
      rank: candidates.find(c => c.name === r.name && c.tld === r.tld)?.rank || 999,
      available: true,
      priceEurHt: r.priceEurHt,
      priceEurTtc: r.priceEurTtc,
      isPremium: r.isPremium,
      isIncluded,
      supplementEurTtc,
    };
  }).filter(Boolean);

  // Sort : .fr en priorité, puis rank GPT, puis "offert" avant "supplement"
  enriched.sort((a, b) => {
    // 1. isIncluded en premier
    if (a.isIncluded !== b.isIncluded) return a.isIncluded ? -1 : 1;
    // 2. Rank GPT croissant
    if (a.rank !== b.rank) return a.rank - b.rank;
    // 3. .fr en priorité
    const tldRank = (t) => TLD_PRIORITY.indexOf(t);
    return tldRank(a.tld) - tldRank(b.tld);
  });

  const payload = {
    slug,
    plan: { key: planKey, label: plan.label, monthlyPriceTtc: plan.monthlyPriceTtc },
    suggestions: enriched,
    totalCheckedAvailable: enriched.length,
    totalChecked: candidates.length,
    droppedPremium, // domaines premium aberrants exclus de la liste
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

  const isIncluded = check.available && check.priceEurTtc != null && check.priceEurTtc <= plan.monthlyPriceTtc;
  const supplementEurTtc = isIncluded ? 0 : (check.priceEurTtc != null ? Math.max(0, Math.round((check.priceEurTtc - plan.monthlyPriceTtc) * 100) / 100) : null);

  res.json({
    hostname,
    available: check.available,
    priceEurHt: check.priceEurHt,
    priceEurTtc: check.priceEurTtc,
    isPremium: check.isPremium,
    isIncluded,
    supplementEurTtc,
    plan: { key: planKey, monthlyPriceTtc: plan.monthlyPriceTtc },
    reason: check.reason,
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

  const isIncluded = check.priceEurTtc != null && check.priceEurTtc <= plan.monthlyPriceTtc;
  const supplementEurTtc = isIncluded ? 0 : Math.max(0, Math.round((check.priceEurTtc - plan.monthlyPriceTtc) * 100) / 100);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  // line_items : subscription + (optionnel) supplément domaine one-time
  const lineItems = [{ price: plan.priceId, quantity: 1 }];
  if (supplementEurTtc > 0) {
    lineItems.push({
      price_data: {
        currency: 'eur',
        product: process.env.STRIPE_PRODUCT_DOMAIN_PREMIUM,
        unit_amount: Math.round(supplementEurTtc * 100),
        tax_behavior: 'inclusive',
      },
      quantity: 1,
    });
  }

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
      metadata: { slug, hostname, plan: planKey, supplementEurTtc: String(supplementEurTtc) },
      // automatic_tax: { enabled: false }, // on calcule TTC manuellement
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

export default router;
