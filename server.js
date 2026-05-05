import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import db from './src/db.js';
import apiRouter from './src/routes/api.js';
import editRouter from './src/routes/edit.js';

// === TENANT_ONLY mode ===
// Sur Falkenstein (= sites coiffeurs payants) on désactive :
//   - admin agence (/admin), Stripe webhook, signup flow (/api/checkout, /api/domain),
//     captures Puppeteer, IA workers, CSV import.
// On garde uniquement : preview, admin coiffeur tokenisé, /api/edit, /api/salon,
// et un endpoint /api/sync pour recevoir les data depuis Helsinki au moment du paiement.
const TENANT_ONLY = process.env.TENANT_ONLY === '1' || process.env.TENANT_ONLY === 'true';

// Routes désactivées en mode TENANT_ONLY (chargées dynamiquement plus bas)
let adminRouter = null;
let checkoutRouter = null;
let stripeWebhookRouter = null;
let recoverRouter = null;
let syncRouter = null;
if (!TENANT_ONLY) {
  ({ default: adminRouter } = await import('./src/routes/admin.js'));
  ({ default: checkoutRouter } = await import('./src/routes/checkout.js'));
  ({ default: stripeWebhookRouter } = await import('./src/routes/stripe-webhook.js'));
  ({ default: recoverRouter } = await import('./src/routes/recover.js'));
} else {
  ({ default: syncRouter } = await import('./src/routes/sync.js'));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || join(__dirname, 'public/screenshots');
// IMPORTANT : UPLOADS_DIR doit utiliser la même logique que src/routes/edit.js
// (sinon Express sert depuis un dossier alors que les uploads sont écrits ailleurs).
// Fallback : à côté de SCREENSHOTS_DIR (= sur le volume persistant en prod).
const UPLOADS_DIR = process.env.UPLOADS_DIR
  || join(process.env.SCREENSHOTS_DIR ? dirname(process.env.SCREENSHOTS_DIR) : join(__dirname, 'data'), 'uploads');
const SITE_DIR = join(__dirname, 'public/site');

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const adminHost = ADMIN_BASE_URL ? new URL(ADMIN_BASE_URL).hostname : null;
const publicHost = PUBLIC_BASE_URL ? new URL(PUBLIC_BASE_URL).hostname : null;

async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL || 'admin@lamidetlm.com';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return;

  let hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    const tempPassword = process.env.ADMIN_PASSWORD || 'change-me-' + Math.random().toString(36).slice(2, 10);
    hash = await bcrypt.hash(tempPassword, 10);
    console.log('============================================');
    console.log('ADMIN USER CREATED');
    console.log('Email:    ', email);
    console.log('Password: ', tempPassword);
    console.log('Sauvegarde ce mot de passe — il ne sera plus affiche.');
    console.log('============================================');
  }
  db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
}

if (!TENANT_ONLY) {
  await ensureAdminUser();
}

const app = express();
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'lax'
  }
}));

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now(), mode: TENANT_ONLY ? 'tenant' : 'tools' }));

// =============================================================================
// SUSPENSION GATE (Falkenstein only)
// =============================================================================
// Si un salon a un subscription_status qui n'est pas dans { live, active }
// (= défaut de paiement, annulation, suspension manuelle), on intercepte les
// routes publiques (preview + admin coiffeur) et on renvoie suspended.html.
// Les données restent en base — réactivation transparente quand le webhook
// customer.subscription.updated repasse en active (cf. stripe-webhook.js).
//
// Statuts considérés "actifs" :
//   - 'live'                       → site provisionné et facturé
//   - 'active'                     → abonnement Stripe actif
//   - 'trialing'                   → période d'essai (devrait pas arriver mais safe)
// Tous les autres (past_due, unpaid, canceled, incomplete, suspended, ...) → page 'site suspendu'.
// =============================================================================
const ACTIVE_STATUSES = new Set(['live', 'active', 'trialing']);

function lookupSalonByHost(req) {
  // Ordre de résolution :
  //   1. live_hostname EXACT match (ex: salon-jean.fr)
  //   2. fallback : si pas trouvé, on retourne null → 404 ailleurs
  try {
    const host = (req.hostname || '').toLowerCase();
    if (!host) return null;
    return db.prepare(
      'SELECT slug, subscription_status, suspended_at, suspended_reason, live_hostname FROM salons WHERE live_hostname = ?'
    ).get(host);
  } catch {
    return null;
  }
}

function lookupSalonBySlug(slug) {
  try {
    return db.prepare(
      'SELECT slug, subscription_status, suspended_at, suspended_reason, live_hostname FROM salons WHERE slug = ?'
    ).get(slug);
  } catch {
    return null;
  }
}

function isSuspended(salon) {
  if (!salon) return false;
  return !ACTIVE_STATUSES.has(salon.subscription_status || '');
}

function serveSuspendedPage(res) {
  // 402 Payment Required (sémantiquement adapté au défaut de paiement)
  return res.status(402).sendFile(join(SITE_DIR, 'legal', 'suspended.html'));
}

// Middleware qui intercepte tout sur Falkenstein si le salon hôte est suspendu.
// On laisse passer :
//   - /legal/*    → page suspended.html + CGV servies en lecture publique
//   - /_assets/*  → CSS/JS pour rendre la page suspendue
//   - /health     → monitoring
if (TENANT_ONLY) {
  app.use((req, res, next) => {
    // Whitelist : on ne bloque jamais ces routes
    if (req.path.startsWith('/legal/')) return next();
    if (req.path.startsWith('/_assets/')) return next();
    if (req.path === '/health') return next();
    if (req.path.startsWith('/screenshots/')) return next();
    if (req.path.startsWith('/uploads/')) return next();
    // /api/sync : auth bearer-protected, garde toujours actif (sinon Helsinki ne peut plus pousser de réactivation)
    if (req.path.startsWith('/api/sync')) return next();

    // Lookup par hostname custom
    const salon = lookupSalonByHost(req);
    if (salon && isSuspended(salon)) return serveSuspendedPage(res);

    // Lookup par slug pour les routes /preview/:slug et /admin/:slug
    const m = req.path.match(/^\/(preview|admin)\/([^/]+)/);
    if (m) {
      const slug = m[2];
      const sBySlug = lookupSalonBySlug(slug);
      if (sBySlug && isSuspended(sBySlug)) return serveSuspendedPage(res);
    }

    next();
  });
}

// Stripe webhook : uniquement sur Helsinki (la signup vit là)
if (!TENANT_ONLY) {
  app.use('/webhook', stripeWebhookRouter);
}

// Sync endpoint : uniquement sur Falkenstein (= reçoit les data depuis Helsinki
// au moment où un coiffeur passe LIVE). Auth par bearer token partagé.
if (TENANT_ONLY) {
  app.use('/api', syncRouter); // expose POST /api/sync/:slug
}

// ====================================================================
// HOSTNAME-AWARE ROUTING (monsitehq.com architecture)
// ====================================================================
// Agency admin tool       : outil.monsitehq.com (ADMIN_BASE_URL)
//   /                     -> redirect to /admin
//   /admin                -> agency dashboard
//   /admin/login          -> login page
//   /admin/<api-route>    -> agency admin API (POST/PUT/DELETE/GET)
//   /api/*                -> public API
//
// Public landing + salon admin : monsitehq.com (PUBLIC_BASE_URL)
//   /                     -> homepage
//   /preview/:slug        -> public landing of a salon
//   /admin/:slug          -> salon's edit page (auth via ?token=xxx)
//   /api/*                -> public API + edit API
//   /screenshots/*        -> static screenshots
//   /uploads/*            -> uploaded photos (hero, gallery)
// ====================================================================

app.use((req, res, next) => {
  const host = req.hostname;
  const isAdminHost = adminHost && host === adminHost;
  const isPublicHost = publicHost && host === publicHost;

  if (isAdminHost) {
    req.routingMode = 'admin';
  } else if (isPublicHost) {
    req.routingMode = 'public';
  } else {
    req.routingMode = 'mixed'; // local dev or unknown host
  }
  next();
});

// Routes always available regardless of host
app.use('/screenshots', express.static(SCREENSHOTS_DIR, { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));
// Normalisation : /legal/privacy.html/  →  redirige 301 vers /legal/privacy.html
// (sécurise les liens partagés ou collés avec un slash final, par ex. dans Stripe).
app.use('/legal', (req, res, next) => {
  if (/\.html\/$/.test(req.path)) {
    return res.redirect(301, req.path.slice(0, -1) + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
  }
  next();
});
// Pages légales (CGV par plan + page de site suspendu) — accessibles publiquement
// sur les deux hôtes (Helsinki + Falkenstein) pour qu'on puisse linker /legal/cgv-2y.html
// depuis la modale pricing ET les afficher sur les sites coiffeurs suspendus.
app.use('/legal', express.static(join(SITE_DIR, 'legal'), { maxAge: '1h' }));
app.use('/api', apiRouter);
app.use('/api', editRouter); // expose /api/edit/:slug

// Routes signup/checkout : uniquement sur Helsinki
if (!TENANT_ONLY) {
  app.use('/api', checkoutRouter); // expose /api/domain/* + /api/checkout/*
  app.use('/', recoverRouter);     // expose POST /api/recover + GET /recover/confirm
  // Page HTML statique du formulaire de récupération (Helsinki uniquement)
  app.get('/recover', (req, res) => res.sendFile(join(SITE_DIR, 'recover.html')));
}

const RESERVED_ADMIN_PATHS = new Set([
  'login', 'logout', 'me', 'index.html', 'login.html',
  'admin.css', 'admin.js', 'i18n.js',
  'upload-csv', 'export-csv', 'screenshot-batch', 'clean-names',
  'salon', 'csv-source', 'screenshot', 'job',
  'groups', 'reset-clean-name'
]);

const RESERVED_PATHS = new Set(['favicon.ico', 'robots.txt', 'sitemap.xml']);
// SITE_DIR is hoisted near the top of this file so the suspension gate (TENANT_ONLY) can use it before route declarations.

// Edit page assets (cropper.js etc.)
app.use('/edit-app', express.static(join(__dirname, 'public/edit')));

// ====================================================================
// PUBLIC HOST GATE on /admin/*
// Sur monsitehq.com (host public), on bloque TOUT sous /admin/* sauf le
// pattern /admin/{slug} (page d'edition coiffeur). Sinon le static middleware
// servirait public/admin/index.html sur monsitehq.com/admin/ — bug de leak.
// ====================================================================
app.use('/admin', (req, res, next) => {
  if (req.routingMode !== 'public') return next();

  // Sur public host, seul /admin/{slug-non-reserve} est servi.
  const rel = req.path; // path relative to /admin (e.g. '/', '/login', '/some-slug')
  if (rel === '/' || rel === '') {
    return res.status(404).sendFile(join(SITE_DIR, '404.html'));
  }
  const firstSeg = rel.split('/').filter(Boolean)[0] || '';
  if (RESERVED_ADMIN_PATHS.has(firstSeg)) {
    return res.status(404).sendFile(join(SITE_DIR, '404.html'));
  }
  // Toute autre URL (suppose etre /admin/{slug}) : laisse passer pour /admin/:slug handler
  next();
});

// Salon edit page : /admin/:slug (auth par token URL, pas par session)
// Defini AVANT le static admin et le adminRouter pour gerer en priorite les slugs.
//
// Sur Helsinki (TOOLS), si le salon a un live_hostname (= déjà payé/migré sur
// Falkenstein), on redirige vers le custom hostname pour que le coiffeur édite
// la version Falkenstein (= source de vérité post-paiement).
app.get('/admin/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (RESERVED_ADMIN_PATHS.has(slug)) return next();
  if (req.routingMode === 'admin') return next();
  if (!TENANT_ONLY) {
    try {
      const r = db.prepare('SELECT live_hostname, subscription_status FROM salons WHERE slug = ?').get(slug);
      if (r && r.live_hostname && (r.subscription_status === 'live' || r.subscription_status === 'active')) {
        const token = req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : '';
        return res.redirect(302, `https://${r.live_hostname}/admin/${encodeURIComponent(slug)}${token}`);
      }
    } catch {}
  }
  res.sendFile(join(__dirname, 'public/edit/index.html'));
});

// === Routes admin agence : uniquement sur Helsinki ===
if (!TENANT_ONLY) {
  // Agency admin assets (CSS, JS, login.html, etc.) — uniquement utilises sur outil.monsitehq.com
  app.use('/admin', express.static(join(__dirname, 'public/admin')));

  // Agency admin login page
  app.get('/admin/login', (req, res) => {
    res.sendFile(join(__dirname, 'public/admin/login.html'));
  });

  // Agency admin dashboard root /admin
  app.get('/admin', (req, res) => {
    if (req.session && req.session.userId) {
      res.sendFile(join(__dirname, 'public/admin/index.html'));
    } else {
      res.redirect('/admin/login');
    }
  });

  // Agency admin auth-protected API routes (login, upload-csv, screenshot, groups, etc.)
  app.use('/admin', adminRouter);
}

// Site assets (CSS, JS for the public landing)
app.use('/_assets', express.static(SITE_DIR, { maxAge: '1d' }));

// Public preview : /preview/:slug
// Sur Helsinki, si salon LIVE → redirect vers le custom hostname (= site servi par Falkenstein).
app.get('/preview/:slug', (req, res) => {
  const slug = req.params.slug;
  if (RESERVED_PATHS.has(slug)) return res.status(404).sendFile(join(SITE_DIR, '404.html'));
  if (!TENANT_ONLY) {
    try {
      const r = db.prepare('SELECT live_hostname, subscription_status FROM salons WHERE slug = ?').get(slug);
      if (r && r.live_hostname && (r.subscription_status === 'live' || r.subscription_status === 'active')) {
        return res.redirect(302, `https://${r.live_hostname}/`);
      }
    } catch {}
  }
  res.sendFile(join(SITE_DIR, 'index.html'));
});

// Sur Falkenstein (TENANT_ONLY), la racine d'un custom hostname (salon-jean.fr/)
// redirige vers /preview/{slug} pour réutiliser le frontend existant.
if (TENANT_ONLY) {
  app.get('/', (req, res) => {
    const host = req.hostname;
    const r = db.prepare('SELECT slug FROM salons WHERE live_hostname = ?').get(host);
    if (r && r.slug) return res.redirect(302, `/preview/${encodeURIComponent(r.slug)}`);
    res.status(404).send('Aucun salon associé à ' + host);
  });
}

// Root
app.get('/', (req, res) => {
  if (req.routingMode === 'admin') return res.redirect('/admin');
  res.sendFile(join(SITE_DIR, 'home.html'));
});

// 404 fallback
app.use((req, res) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(join(SITE_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log(`outil-coiffure listening on http://localhost:${PORT}`);
  console.log(`  Mode           : ${TENANT_ONLY ? 'TENANT (Falkenstein)' : 'TOOLS (Helsinki)'}`);
  console.log(`  Public preview : http://localhost:${PORT}/preview/{slug}`);
  console.log(`  Salon admin    : http://localhost:${PORT}/admin/{slug}?token=...`);
  if (!TENANT_ONLY) {
    console.log(`  Agency admin   : http://localhost:${PORT}/admin (login)`);
  }
});
