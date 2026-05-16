#!/usr/bin/env node
/**
 * OVH domain register — purchase + DNS A record setup.
 *
 * Usage:
 *   node scripts/ovh-buy-domain.mjs maquickpage.fr 65.21.146.193
 *
 * Steps:
 *   1) check availability + price (cart-based)
 *   2) commit checkout (autoPay via preferred method)
 *   3) wait for /me/task/domain to be done
 *   4) replace zone A records on apex + www with TARGET_IP
 *   5) refresh zone
 *
 * Requires env or hardcoded:
 *   OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY
 */

import crypto from 'node:crypto';

const ENDPOINT = process.env.OVH_ENDPOINT || 'https://eu.api.ovh.com/1.0';
const APP_KEY = process.env.OVH_APP_KEY;
const APP_SECRET = process.env.OVH_APP_SECRET;
const CONSUMER_KEY = process.env.OVH_CONSUMER_KEY;
if (!APP_KEY || !APP_SECRET || !CONSUMER_KEY) {
  console.error('Missing OVH credentials. Required env vars: OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY');
  process.exit(1);
}

const DOMAIN = process.argv[2];
const TARGET_IP = process.argv[3] || '65.21.146.193'; // Helsinki VPS by default
const COMMIT = process.argv.includes('--commit'); // safety: dry-run by default
const SKIP_PURCHASE = process.argv.includes('--skip-purchase'); // pour ne faire que le DNS

if (!DOMAIN) {
  console.error('Usage: node ovh-buy-domain.mjs <domain> [target-ip] [--commit] [--skip-purchase]');
  process.exit(1);
}

let timeDelta = null;
async function getTime() {
  if (timeDelta !== null) return Math.floor(Date.now() / 1000) + timeDelta;
  const r = await fetch(`${ENDPOINT}/auth/time`);
  const t = parseInt(await r.text(), 10);
  timeDelta = t - Math.floor(Date.now() / 1000);
  return t;
}

async function call(method, path, body = null) {
  const url = `${ENDPOINT}${path}`;
  const bodyStr = body ? JSON.stringify(body) : '';
  const ts = await getTime();
  const sigData = `${APP_SECRET}+${CONSUMER_KEY}+${method}+${url}+${bodyStr}+${ts}`;
  const sig = '$1$' + crypto.createHash('sha1').update(sigData).digest('hex');
  const res = await fetch(url, {
    method,
    headers: {
      'X-Ovh-Application': APP_KEY,
      'X-Ovh-Consumer': CONSUMER_KEY,
      'X-Ovh-Timestamp': String(ts),
      'X-Ovh-Signature': sig,
      'Content-Type': 'application/json',
    },
    body: bodyStr || undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(`OVH ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

function log(...a) { console.log('[ovh-buy]', ...a); }

async function purchase(domain) {
  // 1. Verify account
  const me = await call('GET', '/me');
  log(`Account: ${me.nichandle} / ${me.email} / ${me.organisation} (${me.legalform})`);

  // 2. Create cart
  const cart = await call('POST', '/order/cart', {
    ovhSubsidiary: 'FR',
    description: `register-${domain}`,
  });
  log(`Cart: ${cart.cartId}`);

  // 3. Assign cart to account
  await call('POST', `/order/cart/${cart.cartId}/assign`, {});

  // 4. Add domain to cart
  const item = await call('POST', `/order/cart/${cart.cartId}/domain`, {
    domain,
    duration: 'P1Y',
  });
  log(`Item added: itemId=${item.itemId} pricingMode=${item.settings?.pricingMode}`);

  // Check pricing mode
  const pmode = item.settings?.pricingMode || '';
  if (!pmode.startsWith('create')) {
    log(`!! Domain not available for creation. pricingMode=${pmode}`);
    log(`!! Item details: ${JSON.stringify(item, null, 2)}`);
    throw new Error(`Domain ${domain} not available (pricingMode=${pmode})`);
  }

  const priceTotal = item.prices?.find(p => p.label === 'TOTAL');
  const priceTtc = item.prices?.find(p => p.label === 'TOTAL_TAX_INCLUSIVE');
  log(`Price HT : ${priceTotal?.price?.value} ${priceTotal?.price?.currencyCode}`);
  log(`Price TTC: ${priceTtc?.price?.value} ${priceTtc?.price?.currencyCode}`);

  // 5. Show checkout summary (GET = preview, no charge)
  const preview = await call('GET', `/order/cart/${cart.cartId}/checkout`);
  log(`Checkout preview: prices.withTax=${preview.prices?.withTax?.value} ${preview.prices?.withTax?.currencyCode}`);
  if (preview.contracts && preview.contracts.length) {
    log(`Contracts (${preview.contracts.length}):`);
    for (const c of preview.contracts) log(`  - ${c.name}: ${c.url}`);
  }

  if (!COMMIT) {
    log(`!! DRY RUN — pass --commit to actually purchase`);
    return { cartId: cart.cartId, committed: false, preview };
  }

  // 6. Commit checkout (this CHARGES the preferred payment method)
  const order = await call('POST', `/order/cart/${cart.cartId}/checkout`, {
    autoPayWithPreferredPaymentMethod: true,
    waiveRetractationPeriod: true,
  });
  log(`!! ORDER COMMITTED. orderId=${order.orderId} status=${order.status}`);
  log(`!! Paid: ${order.prices?.withTax?.value} ${order.prices?.withTax?.currencyCode}`);
  return { cartId: cart.cartId, committed: true, order };
}

async function waitDomainReady(domain, maxSeconds = 300) {
  const start = Date.now();
  while (Date.now() - start < maxSeconds * 1000) {
    try {
      const info = await call('GET', `/domain/${domain}`);
      if (info && info.state === 'ok') {
        log(`Domain ${domain} state=ok (active in OVH)`);
        return true;
      }
      log(`Domain ${domain} state=${info?.state || '?'}, waiting...`);
    } catch (e) {
      if (e.status === 404) {
        log(`Domain ${domain} not yet visible in /domain (404), retrying...`);
      } else {
        log(`Poll error: ${e.message}`);
      }
    }
    await new Promise(r => setTimeout(r, 10_000));
  }
  log(`!! Timeout waiting for domain to be ready`);
  return false;
}

async function setupDNS(domain, ip) {
  log(`Setting up DNS for ${domain} -> ${ip}`);

  // List existing records on the zone
  let records;
  try {
    const ids = await call('GET', `/domain/zone/${domain}/record`);
    records = ids;
  } catch (e) {
    log(`!! Cannot list zone records: ${e.message}`);
    throw e;
  }
  log(`Existing records: ${records.length}`);

  // Inspect each record to find existing A on @ and www
  const toDelete = [];
  for (const id of records) {
    try {
      const rec = await call('GET', `/domain/zone/${domain}/record/${id}`);
      if (rec.fieldType === 'A' && (rec.subDomain === '' || rec.subDomain === 'www')) {
        log(`  found A record id=${id} subDomain="${rec.subDomain}" target=${rec.target} -> will delete`);
        toDelete.push(id);
      }
    } catch (e) {
      log(`  could not read record ${id}: ${e.message}`);
    }
  }

  // Delete old A records
  for (const id of toDelete) {
    try {
      await call('DELETE', `/domain/zone/${domain}/record/${id}`);
      log(`  deleted record ${id}`);
    } catch (e) {
      log(`  delete failed for ${id}: ${e.message}`);
    }
  }

  // Add new A records: apex + www
  for (const sub of ['', 'www']) {
    const rec = await call('POST', `/domain/zone/${domain}/record`, {
      fieldType: 'A',
      subDomain: sub,
      target: ip,
      ttl: 3600,
    });
    log(`  created A record id=${rec.id} subDomain="${sub}" target=${rec.target}`);
  }

  // Refresh zone (apply changes)
  await call('POST', `/domain/zone/${domain}/refresh`, {});
  log(`Zone ${domain} refreshed.`);
}

(async () => {
  try {
    if (!SKIP_PURCHASE) {
      const result = await purchase(DOMAIN);
      if (!result.committed) {
        log('Dry-run complete. No purchase. Re-run with --commit to buy.');
        return;
      }
      log('Purchase committed. Waiting for domain to become active...');
      const ready = await waitDomainReady(DOMAIN);
      if (!ready) {
        log('Domain not yet ready, you can re-run with --skip-purchase later to set DNS.');
        return;
      }
    }
    await setupDNS(DOMAIN, TARGET_IP);
    log('DONE.');
  } catch (e) {
    console.error('FATAL:', e.message);
    if (e.body) console.error('Body:', JSON.stringify(e.body, null, 2));
    process.exit(1);
  }
})();
