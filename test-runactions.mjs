// Test bout en bout pour valider:
// 1. Bug fix : capture respecte la selection (pas tous les salons)
// 2. API expose presentation_scrappee + presentation_corrigee
// 3. /admin/run-actions orchestre clean_names+capture en sequence
// 4. /admin/salon/:slug/presentation sauvegarde manuellement

const BASE = 'https://outil.monsitehq.com';
const PUBLIC_BASE = 'https://monsitehq.com';
const cookies = [];

async function login() {
  const r = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: 'admin@lamidetlm.com', password: 'admin-978a833bd8c32b7a' })
  });
  const setCookie = r.headers.getSetCookie?.() || [];
  for (const c of setCookie) cookies.push(c.split(';')[0]);
  const data = await r.json();
  console.log('[LOGIN]', r.status, data);
}

function cookieHeader() { return cookies.join('; '); }

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Accept: 'application/json', Cookie: cookieHeader(), ...(opts.headers || {}) }
  });
  return { status: r.status, body: await r.json() };
}

async function publicApi(path) {
  const r = await fetch(`${PUBLIC_BASE}${path}`, { headers: { Accept: 'application/json' } });
  return { status: r.status, body: await r.json() };
}

await login();

// Test 1 : API salons retourne presentation_scrappee et corrigee
console.log('\n=== TEST 1 : API salons expose presentation columns ===');
const salonsRes = await api('/api/salons?limit=3');
const sample = salonsRes.body.rows?.[0];
console.log('Sample row keys:', Object.keys(sample || {}));
console.log('Has presentation_scrappee?', 'presentation_scrappee' in (sample || {}));
console.log('Has presentation_corrigee?', 'presentation_corrigee' in (sample || {}));
console.log('Sample presentation_scrappee:', String(sample?.presentation_scrappee || '').slice(0, 80) + '...');

const slugs = (salonsRes.body.rows || []).slice(0, 2).map(r => r.slug);
console.log('Selected slugs for tests:', slugs);

// Test 2 : screenshot-batch avec selection (bug fix)
console.log('\n=== TEST 2 : screenshot-batch respecte la selection ===');
const captureRes = await api('/admin/screenshot-batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slugs, only_missing: false })
});
console.log('Response:', captureRes.body);
console.log('Total in job =', captureRes.body.total, '(expected:', slugs.length, ')');
if (captureRes.body.total !== slugs.length) {
  console.error('!!! BUG : total devrait etre', slugs.length, 'mais est', captureRes.body.total);
} else {
  console.log('OK : capture respecte la selection');
}

// Attendre un peu que le job de capture finisse pour ne pas overlapper avec le suivant
await new Promise(r => setTimeout(r, 30000));

// Test 3 : run-actions avec clean_names + capture (sequentiel)
console.log('\n=== TEST 3 : run-actions orchestrateur (clean_names puis capture) ===');
const runRes = await api('/admin/run-actions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    slugs,
    actions: { clean_names: true, capture: true }
  })
});
console.log('Run response:', runRes.body);
const runJobId = runRes.body.jobId;

// Polling pour suivre le job
let lastPhase = null;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const jobRes = await api(`/admin/run-job/${runJobId}`);
  const job = jobRes.body;
  if (job.phase !== lastPhase) {
    console.log(`[PHASE CHANGE] ${lastPhase} -> ${job.phase}`);
    lastPhase = job.phase;
  }
  console.log(`[${i}] status=${job.status} phase=${job.phase} done=${job.done}/${job.total} errors=${job.errors} breakdown=${JSON.stringify(job.breakdown)}`);
  if (job.status === 'finished' || job.status === 'error') break;
}

// Test 4 : edit manuel d'une presentation
console.log('\n=== TEST 4 : PUT /admin/salon/:slug/presentation ===');
const slugForEdit = slugs[0];
const presRes = await api(`/admin/salon/${slugForEdit}/presentation`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ presentation: 'Texte de test pour la presentation manuelle.' })
});
console.log('PUT presentation:', presRes.body);

const verifyRes = await api(`/api/salons?limit=1&search=${encodeURIComponent(slugForEdit)}`);
const updatedRow = verifyRes.body.rows?.find(r => r.slug === slugForEdit);
console.log('Updated row presentation_corrigee:', updatedRow?.presentation_corrigee);

console.log('\n=== TESTS DONE ===');
