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
// Buffer final apres les waits explicites (fonts + images + reflow). 400ms par
// defaut : suffit pour le repaint apres font swap, configurable via env.
const SETTLE_MS = Math.max(0, parseInt(process.env.SCREENSHOT_SETTLE_MS || '400', 10));
// Logs temporels (active par defaut pour diagnostic). Mettre SCREENSHOT_DEBUG=0 pour couper.
const DEBUG = process.env.SCREENSHOT_DEBUG !== '0';
// Timeout dur par capture : au-dela de ce delai, on force-close la page et on
// retourne une erreur "capture timeout". Evite qu'un renderer Chrome bloque
// indefiniment (default puppeteer protocolTimeout = 180s, beaucoup trop long).
const CAPTURE_TIMEOUT_MS = Math.max(10000, parseInt(process.env.SCREENSHOT_TIMEOUT_MS || '30000', 10));
// Recyclage du browser toutes les N captures pour reset l'etat (memory leak,
// connexions zombies, GPU buffers...). Sans ca, le browser se degrade
// progressivement sur les longs batches.
const BROWSER_RECYCLE_EVERY = Math.max(0, parseInt(process.env.SCREENSHOT_BROWSER_RECYCLE || '30', 10));
// Stagger entre les workers au demarrage d'un chunk : sur Chrome freshly-launched,
// 6 page.screenshot() concurrents peuvent serialiser et timeout. En decalant les
// demarrages de WORKER_STAGGER_MS, on lisse la charge sur l'init du browser.
const WORKER_STAGGER_MS = Math.max(0, parseInt(process.env.SCREENSHOT_WORKER_STAGGER_MS || '350', 10));

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

let browserInstance = null;
// Compteur global de captures depuis le lancement du browser. Quand il atteint
// BROWSER_RECYCLE_EVERY, on relance Chrome pour reset son etat.
let capturesSinceLaunch = 0;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;
  const launchOpts = {
    headless: true,
    // protocolTimeout = delai max pour une commande CDP. Default 180s = beaucoup
    // trop. On le baisse a 25s pour fail-fast si le renderer bloque.
    protocolTimeout: 25000,
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
  capturesSinceLaunch = 0;
  if (DEBUG) console.log(`[browser] launched (protocolTimeout=25s, recycle every ${BROWSER_RECYCLE_EVERY})`);
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    capturesSinceLaunch = 0;
  }
}

// Note : le recyclage du browser se fait entre les chunks dans
// captureBatchParallel (cf. plus bas) — pas via une helper ici, car on doit
// quiescer tous les workers avant de fermer le browser pour eviter qu'une
// page soit tuee en plein vol.

// Attend que le rendu soit reellement termine avant la capture.
// Strategie : forcer le chargement explicite de chaque font/img/bg-image,
// puis verifier l'etat 'loaded' de document.fonts, puis forcer un reflow.
// Plus robuste que document.fonts.ready seul car :
//   - le site utilise Google Fonts avec display=swap → ready peut resoudre
//     avant que le repaint avec la vraie font soit applique
//   - le hero est background-image CSS → networkidle0 ne garantit pas le paint
//   - certaines fonts sont utilisees apres le premier ready (snapshot piege)
async function waitForRenderComplete(page) {
  // 1) FONTS : forcer le chargement de chaque font-family utilisee dans le DOM
  //    via document.fonts.load() (plus deterministe que document.fonts.ready).
  try {
    await page.evaluate(async () => {
      if (!document.fonts) return;

      // Collecte toutes les font-family utilisees dans le DOM
      const stacks = new Set();
      for (const el of document.querySelectorAll('*')) {
        const ff = getComputedStyle(el).fontFamily;
        if (ff && ff !== 'inherit') stacks.add(ff);
      }

      // Force le chargement pour les variantes courantes (poids 300/400/500/600/700, italique).
      // document.fonts.load() retourne une Promise qui ne resout que lorsque
      // les FontFace correspondantes sont vraiment "loaded" (telechargees + utilisables).
      const variants = ['300 16px', '400 16px', '500 16px', '600 16px', '700 16px',
                        'italic 400 16px', 'italic 700 16px'];
      const promises = [];
      for (const stack of stacks) {
        for (const v of variants) {
          // document.fonts.load throw si la query est invalide ; on catch silencieusement
          promises.push(document.fonts.load(`${v} ${stack}`).catch(() => null));
        }
      }
      await Promise.allSettled(promises);

      // Filet de securite : attendre le ready global apres les loads explicites
      try { await document.fonts.ready; } catch {}
    });
  } catch {}

  // 2) Force un reflow + repaint pour appliquer le swap des fonts qui
  //    viennent d'arriver. Sans ca, l'ancien layout (font fallback) peut
  //    persister jusqu'au screenshot.
  try {
    await page.evaluate(() => {
      // Touch layout property -> force synchronous reflow
      // eslint-disable-next-line no-unused-expressions
      document.body.offsetHeight;
    });
  } catch {}

  // 3) IMAGES : <img> + background-image CSS chargees et decodees
  try {
    await page.evaluate(() => new Promise(resolve => {
      const urls = new Set();
      for (const el of document.querySelectorAll('*')) {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') continue;
        const re = /url\((["']?)([^"'()]+)\1\)/g;
        let m;
        while ((m = re.exec(bg)) !== null) {
          if (m[2]) urls.add(m[2]);
        }
      }
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
        setTimeout(finish, 8000);
      }));
      Promise.all(promises).then(() => resolve());
    }));
  } catch {}

  // 4) Buffer final : laisse le repaint final settler (animations, font swap)
  if (SETTLE_MS > 0) await new Promise(r => setTimeout(r, SETTLE_MS));
}

// CSS injecte sur chaque page pour rendre les captures deterministes :
//   - animation-duration: 0s  → toute animation @keyframes (ex. fadeInUp 1s sur
//     .hero-content, bounce sur le scroll-indicator) est instantanement a son
//     etat final. Sinon, la capture peut tomber pendant le fade-in (titre
//     transparent ou en train d'apparaitre).
//   - transition-duration: 0s → pareil pour les transitions
const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

export async function captureSalon(slug) {
  const t0 = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();
  capturesSinceLaunch++;
  if (DEBUG) console.log(`[shot ${slug}] start  t=${new Date(t0).toISOString()}`);

  // Watchdog : si la capture ne se termine pas en CAPTURE_TIMEOUT_MS,
  // on force-close la page (qui annule toutes les commandes CDP en cours
  // et fait propager une erreur dans le try/catch ci-dessous).
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    if (DEBUG) console.log(`[shot ${slug}] watchdog fired (${CAPTURE_TIMEOUT_MS}ms) -> force close page`);
    page.close({ runBeforeUnload: false }).catch(() => {});
  }, CAPTURE_TIMEOUT_MS);

  try {
    await page.setViewport(VIEWPORT);
    const url = `${INTERNAL_BASE}/preview/${slug}?nocapture=1`;
    const tNav0 = Date.now();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
    const tNav1 = Date.now();
    // Desactive les animations CSS AVANT les waits : sinon fadeInUp 1s sur
    // .hero-content peut laisser le titre semi-transparent au moment du shot.
    await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
    await waitForRenderComplete(page);
    const tWait1 = Date.now();

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

    if (DEBUG) {
      const tEnd = Date.now();
      console.log(`[shot ${slug}] done   nav=${tNav1 - tNav0}ms wait=${tWait1 - tNav1}ms shot=${tEnd - tWait1}ms total=${tEnd - t0}ms`);
    }
    return { slug, success: true, screenshot_path: relativeUrl };
  } catch (e) {
    const reason = timedOut ? `capture timeout (${CAPTURE_TIMEOUT_MS}ms)` : e.message;
    if (DEBUG) console.log(`[shot ${slug}] error  ${reason}`);
    return { slug, success: false, error: reason };
  } finally {
    clearTimeout(watchdog);
    // Best-effort close (non-bloquant) : si la page est deja fermee par le
    // watchdog ou un crash, .close() throw silencieusement.
    page.close({ runBeforeUnload: false }).catch(() => {});
  }
}

export async function captureBatch(slugs, onProgress) {
  // Backward compat : appelle la version parallele avec concurrence 1
  return captureBatchParallel(slugs, 1, onProgress);
}

// Pool de workers : N captures Puppeteer concurrentes (N pages dans le meme browser).
// Chaque page consomme ~100-180 Mo. Defaut 6 (configurable via SCREENSHOT_CONCURRENCY).
//
// Pour eviter la degradation progressive du browser sur les longs batches
// (memory leak, connexions zombies), le batch est decoupe en CHUNKS de
// BROWSER_RECYCLE_EVERY captures. Entre chaque chunk, le browser est ferme
// et relance. A l'interieur d'un chunk, aucun recyclage (pas de race).
export async function captureBatchParallel(slugs, concurrency, onProgress) {
  const c = Math.max(1, concurrency || DEFAULT_CONCURRENCY);
  const chunkSize = BROWSER_RECYCLE_EVERY > 0 ? BROWSER_RECYCLE_EVERY : slugs.length;
  const results = new Array(slugs.length);
  let completed = 0;
  const tStart = Date.now();
  if (DEBUG) console.log(`[batch] start total=${slugs.length} concurrency=${c} chunk=${chunkSize} settle=${SETTLE_MS}ms`);

  // Pre-warm le browser
  await getBrowser();

  // Decoupage en chunks pour permettre le recyclage du browser entre les chunks
  for (let chunkStart = 0; chunkStart < slugs.length; chunkStart += chunkSize) {
    const chunkEnd = Math.min(chunkStart + chunkSize, slugs.length);
    const chunk = slugs.slice(chunkStart, chunkEnd);

    // Recycler le browser entre les chunks (sauf avant le premier)
    if (chunkStart > 0) {
      if (DEBUG) console.log(`[browser] recycle before chunk starting at ${chunkStart + 1}/${slugs.length}`);
      const tRecycle0 = Date.now();
      await closeBrowser();
      await getBrowser();
      if (DEBUG) console.log(`[browser] recycled in ${Date.now() - tRecycle0}ms`);
    }

    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(c, chunk.length) }, async (_, workerId) => {
      // Stagger au demarrage du chunk : worker#0 part immediatement, #1 attend
      // WORKER_STAGGER_MS, etc. Evite que 6 page.screenshot() concurrents tombent
      // sur un Chrome qui vient d'etre lance et serialise tout en interne.
      if (workerId > 0 && WORKER_STAGGER_MS > 0) {
        await new Promise(r => setTimeout(r, workerId * WORKER_STAGGER_MS));
      }
      while (true) {
        const i = nextIndex++;
        if (i >= chunk.length) return;
        const globalIdx = chunkStart + i;
        if (DEBUG) console.log(`[batch] worker#${workerId} -> slug ${chunk[i]} (${globalIdx + 1}/${slugs.length})`);
        const result = await captureSalon(chunk[i]);
        results[globalIdx] = result;
        completed++;
        if (onProgress) onProgress({ done: completed, total: slugs.length, last: result });
      }
    });

    await Promise.all(workers);
  }

  if (DEBUG) console.log(`[batch] finished total=${slugs.length} elapsed=${Date.now() - tStart}ms`);
  return results;
}
