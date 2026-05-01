import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import db from './db.js';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || './public/screenshots';
const INTERNAL_BASE = process.env.INTERNAL_SCREENSHOT_BASE_URL || 'http://localhost:3000';
const VIEWPORT = { width: 1280, height: 800 };
const JPEG_QUALITY = 80;
// Concurrence par defaut : 6 pages Puppeteer en parallele dans le meme browser.
// Override via env var SCREENSHOT_CONCURRENCY (ex: 8 si plus de RAM, 4 si VPS petit).
const DEFAULT_CONCURRENCY = Math.max(1, parseInt(process.env.SCREENSHOT_CONCURRENCY || '6', 10));
// Buffer final apres les waits explicites (fonts + images). Plus court qu'avant
// (avant 800ms aveugle) car les attentes ci-dessous sont deterministes.
const SETTLE_MS = Math.max(0, parseInt(process.env.SCREENSHOT_SETTLE_MS || '250', 10));

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  browserInstance = await puppeteer.launch(launchOpts);
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

// Attend que le rendu soit reellement termine avant la capture :
//   1. document.fonts.ready  -> toutes les @font-face (Google Fonts, etc.) sont chargees
//      → sans ca, les titres en font web peuvent etre invisibles (FOIT) ou en fallback.
//   2. Toutes les <img> ET les background-image CSS sont chargees + decoded
//      → le hero du site utilise background-image:url(unsplash...) en CSS, donc
//        networkidle0 + 800ms ne suffit pas si la connexion est lente.
// Cette strategie est plus rapide ET plus fiable qu'un sleep aveugle de 1-2s.
async function waitForRenderComplete(page) {
  // 1) Polices web pretes (titre lisible)
  try {
    await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve());
  } catch {}

  // 2) Images <img> + background-image CSS chargees
  try {
    await page.evaluate(() => new Promise(resolve => {
      const urls = new Set();
      // Collecte tous les background-image: url(...) du DOM visible
      for (const el of document.querySelectorAll('*')) {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') continue;
        const re = /url\((["']?)([^"'()]+)\1\)/g;
        let m;
        while ((m = re.exec(bg)) !== null) {
          if (m[2]) urls.add(m[2]);
        }
      }
      // Tous les <img> du DOM (galerie lazy-load incluse — on force le chargement)
      for (const img of document.images) {
        if (img.src) urls.add(img.src);
      }
      const list = Array.from(urls).filter(Boolean);
      if (list.length === 0) return resolve();

      const promises = list.map(src => new Promise(res => {
        let done = false;
        const finish = () => { if (!done) { done = true; res(); } };
        const i = new Image();
        i.onload = finish;
        i.onerror = finish;
        i.src = src;
        if (i.complete) finish();
        // Garde-fou : 8s max par image pour eviter qu'une image cassee bloque tout
        setTimeout(finish, 8000);
      }));
      Promise.all(promises).then(() => resolve());
    }));
  } catch {}

  // 3) Petit buffer final pour laisser settler les animations CSS / paint
  if (SETTLE_MS > 0) await new Promise(r => setTimeout(r, SETTLE_MS));
}

export async function captureSalon(slug) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    // URL publique du salon : /preview/{slug} (depuis la migration monsitehq.com)
    const url = `${INTERNAL_BASE}/preview/${slug}?nocapture=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await waitForRenderComplete(page);

    const filename = `${slug}.jpg`;
    const filepath = join(SCREENSHOTS_DIR, filename);
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: JPEG_QUALITY,
      fullPage: false
    });
    writeFileSync(filepath, buffer);

    const relativeUrl = `/screenshots/${filename}`;
    db.prepare(`
      UPDATE salons
      SET screenshot_path = ?, screenshot_generated_at = datetime('now'), updated_at = datetime('now')
      WHERE slug = ?
    `).run(relativeUrl, slug);

    return { slug, success: true, screenshot_path: relativeUrl };
  } catch (e) {
    return { slug, success: false, error: e.message };
  } finally {
    await page.close();
  }
}

export async function captureBatch(slugs, onProgress) {
  // Backward compat : appelle la version parallele avec concurrence 1
  return captureBatchParallel(slugs, 1, onProgress);
}

// Pool de workers : N captures Puppeteer concurrentes (N pages dans le meme browser).
// Chaque page consomme ~100-180 Mo. Defaut 6 (configurable via SCREENSHOT_CONCURRENCY).
// Recommandation memoire : ~150 Mo/worker + 200 Mo de base + Node/Express ~ besoin
// (concurrency * 150) + 400 Mo. VPS 2 Go = max 8, VPS 1 Go = max 4.
export async function captureBatchParallel(slugs, concurrency, onProgress) {
  const c = Math.max(1, concurrency || DEFAULT_CONCURRENCY);
  const results = new Array(slugs.length);
  let nextIndex = 0;
  let completed = 0;

  // Pre-warm le browser une fois pour partager entre les workers
  await getBrowser();

  const workers = Array.from({ length: Math.min(c, slugs.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= slugs.length) return;
      const result = await captureSalon(slugs[i]);
      results[i] = result;
      completed++;
      if (onProgress) onProgress({ done: completed, total: slugs.length, last: result });
    }
  });

  await Promise.all(workers);
  return results;
}
