import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1700, height: 1100 });

page.on('pageerror', err => console.log('[PAGEERROR]', err.message));

await page.goto('https://outil.monsitehq.com/admin/login');
await new Promise(r => setTimeout(r, 1000));
await page.type('input[name=email]', 'admin@lamidetlm.com');
await page.type('input[name=password]', 'admin-978a833bd8c32b7a');
await Promise.all([page.click('button[type=submit]'), page.waitForNavigation()]);
await page.waitForFunction(() => document.querySelectorAll('.row-checkbox').length > 0, { timeout: 12000 });
await new Promise(r => setTimeout(r, 800));

// Layout : sections CSV (import + export) + Groupes en dessous
await page.screenshot({ path: 'admin-layout.jpg', type: 'jpeg', quality: 85 });

// Ouvrir la modale d'export
await page.click('#open-export-composer-btn');
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'admin-export-modal.jpg', type: 'jpeg', quality: 85 });

// Decocher 1 source pour montrer l'etat indeterminate
await page.evaluate(() => {
  const sources = document.querySelectorAll('.export-source-checkbox');
  if (sources[0]) sources[0].click();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'admin-export-modal-partial.jpg', type: 'jpeg', quality: 85 });

await browser.close();
console.log('OK');
