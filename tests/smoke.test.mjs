// Smoke tests — vérifie les routes critiques de outil-coiffure en prod.
// Run : npm test (utilise node --test natif, aucune dep)
// Toutes les assertions = régressions critiques à détecter avant deploy.
//
// Pré-requis : outil-coiffure doit être démarré (local sur PORT=3000 ou prod via
// BASE_URL=https://monsitehq.com et ADMIN_BASE_URL=https://outil.monsitehq.com).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'https://monsitehq.com';
const ADMIN = process.env.ADMIN_BASE_URL || 'https://outil.monsitehq.com';
// Pour tester /preview, fournir un slug existant via env (sinon skip).
const EXISTING_SLUG = process.env.TEST_SLUG || '';

async function head(url) {
  const r = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  return { status: r.status, headers: r.headers };
}
async function get(url, opts = {}) {
  const r = await fetch(url, { redirect: 'manual', ...opts });
  return { status: r.status, headers: r.headers, body: await r.text() };
}

describe('Smoke — endpoints publics OK', () => {
  test('GET / → 200', async () => {
    const r = await head(`${BASE}/`);
    assert.equal(r.status, 200);
  });

  test('GET /health → 200 JSON', async () => {
    const r = await get(`${BASE}/health`);
    assert.equal(r.status, 200);
    assert.ok(r.body.includes('"ok":true'));
  });

  test('GET /robots.txt → 200, bloque /preview/ /admin/ /api/', async () => {
    const r = await get(`${BASE}/robots.txt`);
    assert.equal(r.status, 200);
    assert.match(r.body, /Disallow: \/preview\//);
    assert.match(r.body, /Disallow: \/admin\//);
    assert.match(r.body, /Disallow: \/api\//);
  });

  test('GET /sitemap.xml → 200 XML', async () => {
    const r = await get(`${BASE}/sitemap.xml`);
    assert.equal(r.status, 200);
    assert.ok(r.body.includes('<urlset'));
  });
});

describe('Smoke — 404 / erreurs propres', () => {
  test('GET /preview/inexistant-xxx → 404', async () => {
    const r = await head(`${BASE}/preview/inexistant-${Date.now()}`);
    assert.equal(r.status, 404);
  });

  test('GET /admin/inexistant-xxx (sans token) → 401', async () => {
    const r = await head(`${BASE}/admin/inexistant-${Date.now()}`);
    assert.equal(r.status, 401);
  });

  test('GET /admin/{slug}?token=fake → 401', async () => {
    const r = await head(`${BASE}/admin/inexistant-${Date.now()}?token=fakeXXX`);
    assert.equal(r.status, 401);
  });
});

describe('Smoke — Sécurité API (régression #1)', () => {
  test('GET /api/salons sans cookie → 401 (PAS de leak edit_token)', async () => {
    const r = await get(`${BASE}/api/salons?limit=1`);
    assert.equal(r.status, 401, 'CRITICAL: /api/salons doit demander auth');
    assert.ok(!r.body.includes('edit_token'), 'CRITICAL: edit_token fuite dans /api/salons');
  });

  test('GET /api/csv-imports sans cookie → 401', async () => {
    const r = await get(`${BASE}/api/csv-imports`);
    assert.equal(r.status, 401);
  });

  test('GET /api/stats sans cookie → 401', async () => {
    const r = await get(`${BASE}/api/stats`);
    assert.equal(r.status, 401);
  });

  test('GET /api/edit/{slug} sans token → 401', async () => {
    const r = await get(`${BASE}/api/edit/test-slug`);
    assert.equal(r.status, 401);
  });

  test('GET /api/edit/{slug}?token=fake → 401', async () => {
    const r = await get(`${BASE}/api/edit/test-slug?token=fakeXXX`);
    assert.equal(r.status, 401);
  });

  test('GET /api/salon/{slug} (singulier) reste public', async () => {
    const r = await get(`${BASE}/api/salon/inexistant-${Date.now()}`);
    // 404 attendu pour slug inexistant — l'important c'est PAS 401 (route publique)
    assert.notEqual(r.status, 401);
  });
});

describe('Smoke — Stripe webhook signature', () => {
  test('POST /webhook/stripe sans signature → 400', async () => {
    const r = await get(`${BASE}/webhook/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 400);
  });
});

describe('Smoke — Headers sécurité', () => {
  test('Strict-Transport-Security présent', async () => {
    const r = await get(`${BASE}/health`);
    assert.match(r.headers.get('strict-transport-security') || '', /max-age=/);
  });
  test('X-Content-Type-Options: nosniff', async () => {
    const r = await get(`${BASE}/health`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
  test('X-Frame-Options présent', async () => {
    const r = await get(`${BASE}/health`);
    assert.ok(r.headers.get('x-frame-options'));
  });
});

describe('Smoke — Preview salon (si TEST_SLUG)', { skip: !EXISTING_SLUG }, () => {
  test(`GET /preview/${EXISTING_SLUG} → 200 + meta noindex`, async () => {
    const r = await get(`${BASE}/preview/${EXISTING_SLUG}`);
    assert.equal(r.status, 200);
    assert.match(r.body, /<meta name="robots" content="noindex/);
  });
});

describe('Smoke — Admin agence (outil.monsitehq.com)', () => {
  test('GET /admin → redirect login', async () => {
    const r = await get(`${ADMIN}/admin`);
    assert.ok(r.status === 302 || r.status === 301);
    assert.match(r.headers.get('location') || '', /login/);
  });

  test('GET /admin/login → 200', async () => {
    const r = await head(`${ADMIN}/admin/login`);
    assert.equal(r.status, 200);
  });
});
