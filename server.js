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
import adminRouter from './src/routes/admin.js';
import editRouter from './src/routes/edit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || join(__dirname, 'public/screenshots');
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, 'data/uploads');

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

await ensureAdminUser();

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

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

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
app.use('/api', apiRouter);
app.use('/api', editRouter); // expose /api/edit/:slug

// Agency admin assets (CSS, JS, login.html, etc.) — public, no auth required
app.use('/admin', express.static(join(__dirname, 'public/admin')));

// Edit page assets (cropper.js etc.)
app.use('/edit-app', express.static(join(__dirname, 'public/edit')));

// IMPORTANT: routes specifiques AVANT le adminRouter (qui intercepte tout via requireAuth)
// Sinon, GET /admin/{slug} se fait rediriger vers /admin/login par requireAuth.

const RESERVED_ADMIN_PATHS = new Set([
  'login', 'logout', 'me', 'index.html', 'login.html',
  'admin.css', 'admin.js', 'i18n.js',
  'upload-csv', 'export-csv', 'screenshot-batch', 'clean-names',
  'salon', 'csv-source', 'screenshot', 'job',
  'groups', 'reset-clean-name'
]);

// Salon edit page : /admin/:slug (auth par token URL, pas par session)
app.get('/admin/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (RESERVED_ADMIN_PATHS.has(slug)) return next();
  // On agency host, /admin/<unknown> is just unknown — fall through to 404
  if (req.routingMode === 'admin') return next();
  // Public or mixed mode : serve the salon edit page (JS handles auth via token)
  res.sendFile(join(__dirname, 'public/edit/index.html'));
});

// Agency admin login page (must be BEFORE adminRouter to bypass requireAuth)
app.get('/admin/login', (req, res, next) => {
  // Sur le host public (monsitehq.com), l'agency admin n'existe pas → 404
  if (req.routingMode === 'public') return next();
  res.sendFile(join(__dirname, 'public/admin/login.html'));
});

// Agency admin dashboard root /admin
app.get('/admin', (req, res, next) => {
  // Sur le host public, /admin tout seul n'a pas de sens → 404
  if (req.routingMode === 'public') return next();
  if (req.session && req.session.userId) {
    res.sendFile(join(__dirname, 'public/admin/index.html'));
  } else {
    res.redirect('/admin/login');
  }
});

// Sur le host public, on bloque tout le reste de /admin/* (les API agency, etc.)
// pour eviter qu'on serve l'agency admin sur monsitehq.com par erreur.
app.use('/admin', (req, res, next) => {
  if (req.routingMode === 'public') {
    return res.status(404).sendFile(join(SITE_DIR, '404.html'));
  }
  next();
});

// Agency admin auth-protected API routes (login, upload-csv, screenshot, groups, etc.)
app.use('/admin', adminRouter);

const RESERVED_PATHS = new Set(['favicon.ico', 'robots.txt', 'sitemap.xml']);
const SITE_DIR = join(__dirname, 'public/site');

// Site assets (CSS, JS for the public landing)
app.use('/_assets', express.static(SITE_DIR, { maxAge: '1d' }));

// Public preview : /preview/:slug
app.get('/preview/:slug', (req, res) => {
  const slug = req.params.slug;
  if (RESERVED_PATHS.has(slug)) return res.status(404).sendFile(join(SITE_DIR, '404.html'));
  // We don't validate the slug here — the JS will fetch /api/salon/:slug and handle 404
  res.sendFile(join(SITE_DIR, 'index.html'));
});

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
  console.log(`  Public preview : http://localhost:${PORT}/preview/{slug}`);
  console.log(`  Salon admin    : http://localhost:${PORT}/admin/{slug}?token=...`);
  console.log(`  Agency admin   : http://localhost:${PORT}/admin (login)`);
});
