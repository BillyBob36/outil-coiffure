import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import db from './db.js';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || './public/screenshots';
const INTERNAL_BASE = process.env.INTERNAL_SCREENSHOT_BASE_URL || 'http://localhost:3000';
const VIEWPORT = { width: 1280, height: 800 };
const JPEG_QUALITY = 80;

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

export async function captureSalon(slug) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    // URL publique du salon : /preview/{slug} (depuis la migration monsitehq.com)
    const url = `${INTERNAL_BASE}/preview/${slug}?nocapture=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));

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
// Chaque page consomme ~80-150 Mo. 4 en parallele est un bon compromis pour un VPS 2 Go.
export async function captureBatchParallel(slugs, concurrency = 4, onProgress) {
  const results = new Array(slugs.length);
  let nextIndex = 0;
  let completed = 0;

  // Pre-warm le browser une fois pour partager entre les workers
  await getBrowser();

  const workers = Array.from({ length: Math.min(concurrency, slugs.length) }, async () => {
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
