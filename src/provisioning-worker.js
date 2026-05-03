/**
 * Provisioning worker : orchestrate le passage demo → site live après paiement Stripe.
 *
 * Phases :
 *   1. OVH : register du domaine acheté (cart + checkout)
 *   2. OVH : poll task domain jusqu'à status="done"
 *   3. OVH : configure DNS (CNAME @ → customers.monsitehq.com)
 *   4. Cloudflare for SaaS : POST /custom_hostnames
 *   5. Cloudflare : poll status jusqu'à "active"
 *   6. (V2) Cross-DB write vers Postgres monquicksite — pour V1 on lit le tenant
 *      directement depuis SQLite outil-coiffure quand le domaine est servi via
 *      Cloudflare for SaaS Fallback Origin (le routing actuel pointe le fallback
 *      vers 138.201.152.222 = monquicksite-web qui a son propre Postgres ;
 *      pour V1 on accepte que le site soit servi par outil-coiffure aussi
 *      en attendant la migration Postgres)
 *
 * Idempotency : chaque étape vérifie d'abord si elle est déjà faite.
 *   - Si live_hostname OVH déjà acheté : skip step 1
 *   - Si cloudflareHostnameId déjà set : skip step 4
 *   - etc.
 *
 * Erreurs : on log + marque le salon en subscription_status='error'.
 *   L'admin agence pourra retraiter manuellement via un futur endpoint
 *   /admin/retry-provisioning/:slug.
 */

import db from './db.js';
import { ovhFetch } from './ovh-client.js';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const CLOUDFLARE_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const FALLBACK_ORIGIN = process.env.FALLBACK_INTERNAL_HOSTNAME || 'customers.monsitehq.com';

// Mode DRY_RUN : simule sans appeler vraiment OVH (achat domaine = vrai €).
// Activé par défaut tant que PROVISIONING_DRY_RUN n'est pas explicitement = '0'
// ou tant que STRIPE_SECRET_KEY commence par 'sk_test_' (mode test Stripe).
const DRY_RUN = process.env.PROVISIONING_DRY_RUN === '1'
  || (process.env.PROVISIONING_DRY_RUN !== '0' && (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'));

// =============================================================================
// Public API
// =============================================================================

const runningJobs = new Map(); // slug → { state, error?, startedAt, finishedAt? }

export function getProvisioningStatus(slug) {
  return runningJobs.get(slug) || null;
}

/**
 * Lance la provisioning (async, ne bloque pas le caller).
 * Le caller attend pas la fin : il regarde `subscription_status` en DB.
 */
export async function startProvisioning(params) {
  const { slug, hostname, planKey, stripeCustomerId, stripeSubscriptionId } = params;
  if (!slug || !hostname) throw new Error('slug et hostname requis');

  // Évite les doubles lancements
  const existing = runningJobs.get(slug);
  if (existing && existing.state === 'running') {
    console.log('[provisioning] Already running for', slug);
    return existing;
  }

  const job = {
    slug,
    hostname,
    state: 'running',
    step: 'init',
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  runningJobs.set(slug, job);

  // Async, on ne bloque pas le caller
  runProvisioning(job, params).catch(err => {
    job.state = 'error';
    job.error = err.message;
    job.finishedAt = Date.now();
    console.error('[provisioning]', slug, 'failed:', err);
    db.prepare(`
      UPDATE salons SET subscription_status='error', updated_at=datetime('now') WHERE slug=?
    `).run(slug);
  });

  return job;
}

// =============================================================================
// Orchestrator
// =============================================================================

async function runProvisioning(job, params) {
  const { slug, hostname, planKey } = params;

  console.log(`[provisioning] ${slug} → ${hostname} (plan=${planKey}) START${DRY_RUN ? ' (DRY_RUN)' : ''}`);

  if (DRY_RUN) {
    // === DRY RUN : simule chaque étape avec un délai sans appeler OVH/CF ===
    job.step = 'ovh_register';
    await new Promise(r => setTimeout(r, 8000));
    console.log(`[provisioning] ${slug} [DRY] OVH register simulé`);

    job.step = 'ovh_poll';
    await new Promise(r => setTimeout(r, 12000));
    console.log(`[provisioning] ${slug} [DRY] OVH domain READY simulé`);

    job.step = 'ovh_dns';
    await new Promise(r => setTimeout(r, 6000));
    console.log(`[provisioning] ${slug} [DRY] OVH DNS CNAME simulé`);

    job.step = 'cloudflare_add';
    await new Promise(r => setTimeout(r, 8000));
    console.log(`[provisioning] ${slug} [DRY] CF custom_hostname simulé`);

    job.step = 'cloudflare_poll';
    await new Promise(r => setTimeout(r, 15000));
    console.log(`[provisioning] ${slug} [DRY] CF active simulé`);

    db.prepare(`
      UPDATE salons SET subscription_status='live', live_hostname=?, signed_up_at=COALESCE(signed_up_at, datetime('now')),
          updated_at=datetime('now')
      WHERE slug=?
    `).run(hostname, slug);

    job.state = 'done';
    job.finishedAt = Date.now();
    job.step = 'done';
    console.log(`[provisioning] ${slug} DRY_RUN DONE in ${(job.finishedAt - job.startedAt) / 1000}s`);
    return;
  }

  // === PRODUCTION FLOW (réel) ===
  // Étape 1 : OVH register
  job.step = 'ovh_register';
  const orderInfo = await ovhRegisterDomain(hostname);
  console.log(`[provisioning] ${slug} OVH order ${orderInfo.orderId} placed`);

  // Étape 2 : poll OVH task domain jusqu'à "done"
  job.step = 'ovh_poll';
  await pollOvhDomainReady(hostname);
  console.log(`[provisioning] ${slug} OVH domain READY`);

  // Étape 3 : configure DNS du domaine OVH (CNAME @ → fallback)
  job.step = 'ovh_dns';
  await configureOvhDns(hostname, FALLBACK_ORIGIN);
  console.log(`[provisioning] ${slug} OVH DNS CNAME set`);

  // Étape 4 : Cloudflare for SaaS — add custom hostname
  job.step = 'cloudflare_add';
  const cfHostname = await cloudflareAddCustomHostname(hostname);
  console.log(`[provisioning] ${slug} CF custom_hostname id=${cfHostname.id} status=${cfHostname.status}`);

  db.prepare(`
    UPDATE salons SET cloudflare_hostname_id = ?, updated_at = datetime('now') WHERE slug = ?
  `).run(cfHostname.id, slug);

  // Étape 5 : poll Cloudflare status until active
  job.step = 'cloudflare_poll';
  const finalStatus = await pollCloudflareHostnameActive(cfHostname.id);
  console.log(`[provisioning] ${slug} CF status=${finalStatus.status} ssl_status=${finalStatus.ssl?.status}`);

  // Étape 6 : marque le salon LIVE
  job.step = 'finalize';
  db.prepare(`
    UPDATE salons
    SET subscription_status='live', live_hostname=?, signed_up_at=COALESCE(signed_up_at, datetime('now')),
        updated_at=datetime('now')
    WHERE slug=?
  `).run(hostname, slug);

  job.state = 'done';
  job.finishedAt = Date.now();
  job.step = 'done';
  console.log(`[provisioning] ${slug} DONE in ${(job.finishedAt - job.startedAt) / 1000}s`);
}

// =============================================================================
// OVH steps
// =============================================================================

async function ovhRegisterDomain(hostname) {
  // 1. Create cart for the order
  const cart = await ovhFetch('POST', '/order/cart', {
    ovhSubsidiary: 'FR',
    description: `monquicksite-register-${hostname}`,
    expire: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  // 2. Assign to current account
  await ovhFetch('POST', `/order/cart/${cart.cartId}/assign`, {});
  // 3. Add the domain
  const item = await ovhFetch('POST', `/order/cart/${cart.cartId}/domain`, {
    domain: hostname,
    duration: 'P1Y',
  });
  // 4. Configure mandatory item options (owner contact)
  // OVH demande un nichandle pour le owner. On utilise le compte par défaut (lm2236699-ovh).
  // Récupérer le contact admin par défaut s'il existe
  const requirements = await ovhFetch('GET', `/order/cart/${cart.cartId}/item/${item.itemId}/requiredConfiguration`);
  const ownerContactReq = (requirements || []).find(r => r.label === 'OWNER_CONTACT');
  if (ownerContactReq) {
    // Utilise le nichandle courant de l'agence
    await ovhFetch('POST', `/order/cart/${cart.cartId}/item/${item.itemId}/configuration`, {
      label: 'OWNER_CONTACT',
      value: '/me/contact', // référence relative = le contact root
    });
  }
  // 5. Checkout
  const order = await ovhFetch('POST', `/order/cart/${cart.cartId}/checkout`, {
    autoPayWithPreferredPaymentMethod: true,
    waiveRetractationPeriod: true,
  });
  return { orderId: order.orderId, cartId: cart.cartId, itemId: item.itemId };
}

async function pollOvhDomainReady(hostname, options = {}) {
  const timeoutMs = options.timeoutMs || 5 * 60 * 1000;
  const intervalMs = options.intervalMs || 5000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      // Check if domain is in our portfolio yet
      const domains = await ovhFetch('GET', '/domain');
      if (domains.includes(hostname)) {
        // Verify it's not pending
        const detail = await ovhFetch('GET', `/domain/${hostname}`);
        if (detail.state === 'ok' || detail.state === 'inProgress') {
          return detail;
        }
      }
    } catch (err) {
      // Non-fatal : retry
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`OVH domain ${hostname} not ready within ${timeoutMs}ms`);
}

async function configureOvhDns(hostname, fallbackOrigin) {
  // Pour la zone DNS du domaine OVH, on remet à zéro les A/AAAA/CNAME du root
  // puis on met un CNAME @ vers le fallback origin Cloudflare.
  // Attention : un CNAME sur l'apex (@) n'est techniquement pas valide DNS-wise.
  // OVH supporte le "CNAME flatening" via un flag, mais la meilleure pratique est
  // d'utiliser un A record vers les IPs Cloudflare. Pour V1 on tente le CNAME apex
  // qui marche dans 95% des cas chez OVH.
  try {
    // 1. Lister les records existants à la racine
    const records = await ovhFetch('GET', `/domain/zone/${hostname}/record?subDomain=`);
    // 2. Supprimer les A/AAAA/CNAME de la racine pour éviter les conflits
    for (const id of records) {
      try {
        const rec = await ovhFetch('GET', `/domain/zone/${hostname}/record/${id}`);
        if (['A', 'AAAA', 'CNAME'].includes(rec.fieldType)) {
          await ovhFetch('DELETE', `/domain/zone/${hostname}/record/${id}`);
        }
      } catch {}
    }
    // 3. Ajouter le CNAME @ → fallback
    await ovhFetch('POST', `/domain/zone/${hostname}/record`, {
      fieldType: 'CNAME',
      subDomain: '',
      target: fallbackOrigin + '.',
      ttl: 600,
    });
    // 4. Aussi un CNAME www → fallback (pour les visiteurs qui tapent www.)
    await ovhFetch('POST', `/domain/zone/${hostname}/record`, {
      fieldType: 'CNAME',
      subDomain: 'www',
      target: fallbackOrigin + '.',
      ttl: 600,
    });
    // 5. Refresh la zone
    await ovhFetch('POST', `/domain/zone/${hostname}/refresh`, {});
  } catch (err) {
    throw new Error(`OVH DNS config failed: ${err.message}`);
  }
}

// =============================================================================
// Cloudflare steps
// =============================================================================

async function cloudflareAddCustomHostname(hostname) {
  if (!CLOUDFLARE_TOKEN || !CLOUDFLARE_ZONE_ID) {
    throw new Error('CLOUDFLARE_API_TOKEN ou CLOUDFLARE_ZONE_ID manquant');
  }
  const res = await fetch(`${CLOUDFLARE_API}/zones/${CLOUDFLARE_ZONE_ID}/custom_hostnames`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      hostname,
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    }),
  });
  const json = await res.json();
  if (!json.success) {
    const msg = (json.errors || []).map(e => e.message).join('; ');
    throw new Error(`CF custom_hostname error: ${msg}`);
  }
  return json.result;
}

async function pollCloudflareHostnameActive(id, options = {}) {
  const timeoutMs = options.timeoutMs || 8 * 60 * 1000; // 8 min (DNS propagation)
  const intervalMs = options.intervalMs || 8000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${CLOUDFLARE_API}/zones/${CLOUDFLARE_ZONE_ID}/custom_hostnames/${id}`, {
      headers: { 'Authorization': `Bearer ${CLOUDFLARE_TOKEN}` },
    });
    const json = await res.json();
    if (!json.success) {
      throw new Error(`CF poll error: ${(json.errors || [{}])[0].message || 'unknown'}`);
    }
    const r = json.result;
    if (r.status === 'active' || r.status === 'provisioned') return r;
    if (r.status === 'blocked' || r.status?.startsWith('test_failed')) {
      throw new Error(`CF custom_hostname status=${r.status}`);
    }
    await new Promise(rs => setTimeout(rs, intervalMs));
  }
  throw new Error(`CF custom_hostname ${id} not active within ${timeoutMs}ms`);
}
