// Preuve visuelle des 2 modes galerie (Ajouter/Remplacer) sur la PROD.
// Usage: ADMIN_PWD=... node scripts/proof-gallery-modes.mjs
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const BASE = 'https://outil.maquickpage.fr';
const EMAIL = process.env.ADMIN_EMAIL_PROD || 'admin@lamidetlm.com';
const PWD = process.env.ADMIN_PWD;
const OUT = 'D:/images-coiffeurs/proofs';
if (!PWD) { console.error('ADMIN_PWD requis'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });

await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle2', timeout: 45000 });
const login = await page.evaluate(async (email, pwd) => {
  const r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email, password: pwd }) });
  return await r.json();
}, EMAIL, PWD);
console.log('login:', JSON.stringify(login));
if (!login.ok) { await browser.close(); process.exit(1); }

await page.goto(`${BASE}/admin/stats.html`, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3500));

// Ouvre la modale du salon test + coche 2 cases galerie pour montrer les 2 boutons actifs
const ok = await page.evaluate(() => {
  const a = document.querySelector('[data-photos="test-photo-systeme"]') || document.querySelector('[data-photos]');
  if (!a) return 'no-button';
  a.click();
  return 'opened';
});
console.log('modale:', ok);
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(() => {
  const boxes = document.querySelectorAll('[data-gal]');
  if (boxes[0]) boxes[0].click();
  if (boxes[1]) boxes[1].click();
});
await new Promise(r => setTimeout(r, 600));
const btns = await page.evaluate(() => ({
  add: (document.getElementById('pm-gal-add') || {}).textContent,
  replace: (document.getElementById('pm-gal-replace') || {}).textContent,
}));
console.log('boutons:', JSON.stringify(btns));
await page.screenshot({ path: `${OUT}/5-galerie-2-modes.jpg`, type: 'jpeg', quality: 88, fullPage: false });
console.log('shot 5 ok');

await browser.close();
console.log('PROOF_DONE');
