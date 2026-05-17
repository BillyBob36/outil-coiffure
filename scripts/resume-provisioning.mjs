/**
 * Resume provisioning for a salon that's stuck in 'provisioning' state.
 * Assumes the domain is already purchased at OVH; skips the OVH register step.
 *
 * Usage: SLUG=xxx HOSTNAME=xxx.fr node scripts/resume-provisioning.mjs
 */
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const SLUG = process.env.SLUG;
const HOSTNAME = process.env.HOSTNAME;
if (!SLUG || !HOSTNAME) { console.error('SLUG + HOSTNAME env required'); process.exit(1); }

// ===== OVH signed fetch =====
const OVH_ENDPOINT = process.env.OVH_ENDPOINT || 'https://eu.api.ovh.com/1.0';
const OVH_APP_KEY = process.env.OVH_APP_KEY;
const OVH_APP_SECRET = process.env.OVH_APP_SECRET;
const OVH_CONSUMER_KEY = process.env.OVH_CONSUMER_KEY;
let timeDelta = null;
async function getOvhTime() {
  if (timeDelta !== null) return Math.floor(Date.now()/1000) + timeDelta;
  const r = await fetch(`${OVH_ENDPOINT}/auth/time`);
  const t = parseInt(await r.text(), 10);
  timeDelta = t - Math.floor(Date.now()/1000);
  return t;
}
async function ovhFetch(method, path, body=null) {
  const url = `${OVH_ENDPOINT}${path}`;
  const bs = body ? JSON.stringify(body) : '';
  const ts = await getOvhTime();
  const sig = '$1$' + crypto.createHash('sha1').update(`${OVH_APP_SECRET}+${OVH_CONSUMER_KEY}+${method}+${url}+${bs}+${ts}`).digest('hex');
  const r = await fetch(url, { method, headers: { 'X-Ovh-Application': OVH_APP_KEY, 'X-Ovh-Consumer': OVH_CONSUMER_KEY, 'X-Ovh-Timestamp': String(ts), 'X-Ovh-Signature': sig, 'Content-Type': 'application/json' }, body: bs || undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(`OVH ${method} ${path} → ${r.status}: ${txt.slice(0,300)}`);
  return txt ? JSON.parse(txt) : null;
}

// ===== Cloudflare fetch =====
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ZONE = process.env.CLOUDFLARE_ZONE_ID;
const FALLBACK = process.env.FALLBACK_INTERNAL_HOSTNAME || 'customers.monsitehq.com';
async function cfFetch(method, path, body=null) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!j.success) throw new Error(`CF ${method} ${path} → ${r.status}: ${JSON.stringify(j.errors || j)}`);
  return j.result;
}

// ===== Steps =====
async function step2_pollOvh() {
  console.log(`[step 2] Poll OVH /domain/${HOSTNAME} until state=ok...`);
  const start = Date.now();
  while (Date.now() - start < 5*60*1000) {
    try {
      const info = await ovhFetch('GET', `/domain/${HOSTNAME}`);
      console.log(`         state=${info?.state}`);
      if (info && info.state === 'ok') return;
    } catch (e) { console.log(`         poll err: ${e.message}`); }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Timeout polling OVH domain ready');
}

// Cloudflare anycast IPs (= les mêmes que customers.monsitehq.com utilise déjà).
// Un CNAME sur l'apex n'est pas valide DNS-wise et OVH refuse l'opération.
// On pousse donc des A records vers Cloudflare ; CF for SaaS routera ensuite
// vers le fallback origin (customers.monsitehq.com → Falkenstein).
const CF_ANYCAST_IPV4 = ['188.114.97.2', '188.114.96.2'];
const CF_ANYCAST_IPV6 = ['2a06:98c1:3120::2', '2a06:98c1:3121::2'];

async function step3_dns() {
  console.log(`[step 3] Configure OVH DNS: A + AAAA apex + www → Cloudflare anycast`);
  // List existing records on apex + www, delete A/AAAA/CNAME for clean state
  const ids = await ovhFetch('GET', `/domain/zone/${HOSTNAME}/record`);
  for (const id of ids) {
    try {
      const rec = await ovhFetch('GET', `/domain/zone/${HOSTNAME}/record/${id}`);
      if ((rec.subDomain === '' || rec.subDomain === 'www') && ['A', 'AAAA', 'CNAME'].includes(rec.fieldType)) {
        console.log(`         delete existing ${rec.fieldType} ${rec.subDomain || '@'} → ${rec.target}`);
        await ovhFetch('DELETE', `/domain/zone/${HOSTNAME}/record/${id}`);
      }
    } catch {}
  }
  // Add A + AAAA records to apex AND www
  for (const sub of ['', 'www']) {
    for (const ip of CF_ANYCAST_IPV4) {
      const rec = await ovhFetch('POST', `/domain/zone/${HOSTNAME}/record`, {
        fieldType: 'A', subDomain: sub, target: ip, ttl: 3600,
      });
      console.log(`         created A id=${rec.id} subDomain="${sub}" → ${ip}`);
    }
    for (const ip of CF_ANYCAST_IPV6) {
      const rec = await ovhFetch('POST', `/domain/zone/${HOSTNAME}/record`, {
        fieldType: 'AAAA', subDomain: sub, target: ip, ttl: 3600,
      });
      console.log(`         created AAAA id=${rec.id} subDomain="${sub}" → ${ip}`);
    }
  }
  await ovhFetch('POST', `/domain/zone/${HOSTNAME}/refresh`, {});
  console.log(`         zone refreshed`);
}

async function step4_cfAdd() {
  console.log(`[step 4] Cloudflare for SaaS: add custom_hostname ${HOSTNAME}`);
  const ch = await cfFetch('POST', `/zones/${CF_ZONE}/custom_hostnames`, {
    hostname: HOSTNAME,
    ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
  });
  console.log(`         CF id=${ch.id} status=${ch.status}`);
  return ch;
}

async function step5_cfPoll(id) {
  console.log(`[step 5] Poll CF custom_hostname until SSL active...`);
  const start = Date.now();
  while (Date.now() - start < 8*60*1000) {
    const ch = await cfFetch('GET', `/zones/${CF_ZONE}/custom_hostnames/${id}`);
    console.log(`         status=${ch.status} ssl=${ch.ssl?.status}`);
    if (ch.status === 'active' && (ch.ssl?.status === 'active' || ch.ssl?.status === 'pending_deployment')) return ch;
    await new Promise(r => setTimeout(r, 10000));
  }
  console.warn('         CF poll timeout — continuing anyway (cert can finalize in background)');
}

async function main() {
  const db = new Database('/data/salons.db');
  try {
    await step2_pollOvh();
    await step3_dns();
    const ch = await step4_cfAdd();
    db.prepare(`UPDATE salons SET cloudflare_hostname_id=?, updated_at=datetime('now') WHERE slug=?`).run(ch.id, SLUG);
    await step5_cfPoll(ch.id);

    console.log(`[step 6] Mark salon LIVE`);
    db.prepare(`UPDATE salons SET subscription_status='live', live_hostname=?, signed_up_at=COALESCE(signed_up_at, datetime('now')), updated_at=datetime('now') WHERE slug=?`).run(HOSTNAME, SLUG);

    console.log(`[step 7] syncSalonToFalkenstein...`);
    const mod = await import('/app/src/provisioning-worker.js');
    await mod.syncSalonToFalkenstein(SLUG);
    console.log(`         synced`);

    console.log(`[step 8] Send signup confirmation email`);
    const emailMod = await import('/app/src/email-sender.js');
    const salon = db.prepare(`SELECT slug, nom, nom_clean, plan, edit_token, owner_email FROM salons WHERE slug=?`).get(SLUG);
    const emailRes = await emailMod.sendSignupSuccessEmail({
      to: salon.owner_email,
      salonName: salon.nom_clean || salon.nom || SLUG,
      liveHostname: HOSTNAME,
      plan: salon.plan,
      slug: salon.slug,
      editToken: salon.edit_token,
    });
    console.log(`         email:`, emailRes?.ok ? 'OK' : JSON.stringify(emailRes));

    console.log(`[DONE] ${SLUG} is LIVE on https://${HOSTNAME}`);
  } catch (e) {
    console.error(`[FAILED]`, e.message);
    db.prepare(`UPDATE salons SET subscription_status='error', updated_at=datetime('now') WHERE slug=?`).run(SLUG);
    process.exit(1);
  }
}

main();
