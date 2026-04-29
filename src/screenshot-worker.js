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
    const url = `${INTERNAL_BASE}/${slug}?nocapture=1`;
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
  const results = [];
  for (let i = 0; i < slugs.length; i++) {
    const result = await captureSalon(slugs[i]);
    results.push(result);
    if (onProgress) onProgress({ done: i + 1, total: slugs.length, last: result });
  }
  return results;
}
