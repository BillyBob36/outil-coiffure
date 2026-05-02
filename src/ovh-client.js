/**
 * OVHcloud API client — utilitaires pour vérifier la dispo + prix d'un domaine.
 *
 * OVH utilise des requêtes signées (X-Ovh-Signature SHA-1).
 * Doc : https://help.ovhcloud.com/csm/en-api-getting-started?id=kb_article_view&sysparm_article=KB0042777
 *
 * Pour le check de domaine :
 * - On crée un cart (POST /order/cart), TTL 30 min
 * - On y ajoute le domaine (POST /order/cart/{id}/domain) → retourne dispo + prix
 * - On peut réutiliser le même cart pour 30 min → on cache un cart actif côté process
 */

import crypto from 'node:crypto';

const OVH_ENDPOINT = process.env.OVH_ENDPOINT || 'https://eu.api.ovh.com/1.0';
const OVH_APP_KEY = process.env.OVH_APP_KEY || '';
const OVH_APP_SECRET = process.env.OVH_APP_SECRET || '';
const OVH_CONSUMER_KEY = process.env.OVH_CONSUMER_KEY || '';

// === Signature SHA-1 OVH ===
async function ovhSignature(method, url, body, timestamp) {
  const data = `${OVH_APP_SECRET}+${OVH_CONSUMER_KEY}+${method}+${url}+${body}+${timestamp}`;
  const hash = crypto.createHash('sha1').update(data).digest('hex');
  return `$1$${hash}`;
}

// Cache du delta time entre nous et OVH (synchro horloge)
let ovhTimeDelta = null;

async function getOvhTime() {
  if (ovhTimeDelta !== null) {
    return Math.floor(Date.now() / 1000) + ovhTimeDelta;
  }
  try {
    const res = await fetch(`${OVH_ENDPOINT}/auth/time`);
    const remoteTime = parseInt(await res.text(), 10);
    const localTime = Math.floor(Date.now() / 1000);
    ovhTimeDelta = remoteTime - localTime;
    return remoteTime;
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Appel signé OVH.
 */
export async function ovhFetch(method, path, body = null) {
  if (!OVH_APP_KEY || !OVH_APP_SECRET || !OVH_CONSUMER_KEY) {
    throw new Error('OVH credentials missing (OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY)');
  }
  const url = `${OVH_ENDPOINT}${path}`;
  const bodyStr = body ? JSON.stringify(body) : '';
  const timestamp = await getOvhTime();
  const signature = await ovhSignature(method, url, bodyStr, timestamp);

  const res = await fetch(url, {
    method,
    headers: {
      'X-Ovh-Application': OVH_APP_KEY,
      'X-Ovh-Consumer': OVH_CONSUMER_KEY,
      'X-Ovh-Timestamp': String(timestamp),
      'X-Ovh-Signature': signature,
      'Content-Type': 'application/json',
    },
    body: bodyStr || undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`OVH ${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// =============================================================================
// CART MANAGEMENT
// =============================================================================
// On garde un cart actif par worker, recréé si expiré (TTL OVH = 30 min).
let cachedCart = null; // { cartId, expireAt }

async function ensureCart() {
  const now = Date.now();
  if (cachedCart && cachedCart.expireAt > now + 60_000) {
    return cachedCart.cartId;
  }
  // Crée un nouveau cart (descripteur 'monquicksite-domain-check')
  const cart = await ovhFetch('POST', '/order/cart', {
    ovhSubsidiary: 'FR',
    description: 'monquicksite-domain-check',
    expire: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  // On l'assigne au compte courant (sinon on peut pas checkout dessus)
  await ovhFetch('POST', `/order/cart/${cart.cartId}/assign`, {});
  cachedCart = {
    cartId: cart.cartId,
    expireAt: new Date(cart.expire).getTime(),
  };
  return cart.cartId;
}

// =============================================================================
// CHECK DOMAIN AVAILABILITY + PRICE
// =============================================================================

/**
 * Vérifie la dispo + le prix d'un domaine via le cart-based check.
 *
 * Returns :
 *   {
 *     available: true,
 *     priceEurHt: 5.59,
 *     priceEurTtc: 6.71,
 *     isPremium: false
 *   }
 *
 * Ou en cas d'indisponibilité :
 *   { available: false, reason: 'unavailable' | 'restricted' | 'reserved' | ... }
 */
export async function checkDomainAvailability(hostname) {
  const cartId = await ensureCart();
  // POST /order/cart/{cartId}/domain accepte un body { domain, duration?, offerId? }
  // Si dispo : retourne { itemId, prices: [{label, price}], settings }
  // Si pas dispo : 4xx avec un message
  try {
    const item = await ovhFetch('POST', `/order/cart/${cartId}/domain`, {
      domain: hostname,
      duration: 'P1Y',
    });
    // Récupérer le prix avec et sans TVA
    const priceItem = (item.prices || []).find(p => p.label === 'TOTAL') || (item.prices || [])[0];
    const priceEurHt = priceItem ? priceItem.price.value : null;
    // En FR la TVA est 20% sur les services SaaS, OVH renvoie les 2 si "TOTAL_TAX_INCLUSIVE" exists
    const totalTtc = (item.prices || []).find(p => p.label === 'TOTAL_TAX_INCLUSIVE');
    const priceEurTtc = totalTtc ? totalTtc.price.value : (priceEurHt != null ? priceEurHt * 1.2 : null);
    // Detect premium : prix > 30€ HT/an = probablement premium-priced par registry
    const isPremium = priceEurHt != null && priceEurHt > 30;

    // Cleanup l'item du cart pour pas qu'il s'accumule (cart limit 50 items)
    if (item.itemId) {
      ovhFetch('DELETE', `/order/cart/${cartId}/item/${item.itemId}`).catch(() => {});
    }

    return {
      available: true,
      priceEurHt: priceEurHt != null ? Math.round(priceEurHt * 100) / 100 : null,
      priceEurTtc: priceEurTtc != null ? Math.round(priceEurTtc * 100) / 100 : null,
      isPremium,
    };
  } catch (err) {
    // OVH retourne typiquement 400 ou 404 si le domain est pas disponible/invalide
    if (err.status === 400 || err.status === 404) {
      return { available: false, reason: 'unavailable', message: err.body?.slice(0, 200) };
    }
    // Autre erreur (réseau, auth, etc.) → propager
    throw err;
  }
}

/**
 * Vérifie en parallèle plusieurs combinaisons (nom × TLD).
 *
 * @param {Array<{name: string, tld: string}>} candidates
 * @param {Object} options { concurrency: 8 (default) }
 * @returns Promise<Array<{name, tld, hostname, ...checkResult}>>
 */
export async function checkDomainsParallel(candidates, options = {}) {
  const concurrency = options.concurrency || 8;
  const results = new Array(candidates.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= candidates.length) return;
      const { name, tld } = candidates[i];
      const hostname = `${name}${tld}`;
      try {
        const check = await checkDomainAvailability(hostname);
        results[i] = { name, tld, hostname, ...check };
      } catch (err) {
        results[i] = { name, tld, hostname, available: false, reason: 'error', error: err.message };
      }
    }
  });

  await Promise.all(workers);
  return results;
}
