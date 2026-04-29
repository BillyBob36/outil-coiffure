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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || join(__dirname, 'public/screenshots');

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

app.use('/screenshots', express.static(SCREENSHOTS_DIR, { maxAge: '1h' }));

app.use((req, res, next) => {
  const host = req.hostname;
  const isAdminHost = adminHost && host === adminHost;
  const isPublicHost = publicHost && host === publicHost;

  if (isAdminHost) {
    req.routingMode = 'admin';
  } else if (isPublicHost) {
    req.routingMode = 'public';
  } else {
    req.routingMode = 'mixed';
  }
  next();
});

app.use('/api', apiRouter);
app.use('/admin', adminRouter);

app.use('/admin', express.static(join(__dirname, 'public/admin')));

app.get('/admin', (req, res) => {
  if (req.session && req.session.userId) {
    res.sendFile(join(__dirname, 'public/admin/index.html'));
  } else {
    res.redirect('/admin/login');
  }
});
app.get('/admin/login', (req, res) => {
  res.sendFile(join(__dirname, 'public/admin/login.html'));
});

const RESERVED_PATHS = new Set(['favicon.ico', 'robots.txt', 'sitemap.xml']);
const SITE_DIR = join(__dirname, 'public/site');

app.get('/', (req, res) => {
  if (req.routingMode === 'admin') return res.redirect('/admin');
  res.sendFile(join(SITE_DIR, 'home.html'));
});

app.use('/_assets', express.static(SITE_DIR, { maxAge: '1d' }));

app.get('/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (RESERVED_PATHS.has(slug)) return next();
  if (slug.startsWith('admin')) return next();

  const row = db.prepare('SELECT slug FROM salons WHERE slug = ?').get(slug);
  if (!row) {
    res.status(404).sendFile(join(SITE_DIR, '404.html'));
    return;
  }
  res.sendFile(join(SITE_DIR, 'index.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/admin')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(join(SITE_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log(`outil-coiffure listening on http://localhost:${PORT}`);
  console.log(`  Public site: http://localhost:${PORT}/{slug}`);
  console.log(`  Admin:       http://localhost:${PORT}/admin`);
});
