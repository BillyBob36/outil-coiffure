import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

page.on('console', msg => console.log('[BROWSER]', msg.type(), msg.text()));
page.on('pageerror', err => console.log('[PAGEERROR]', err.message));
page.on('response', r => { if (!r.ok() && r.url().includes('monsitehq')) console.log('[HTTP-ERR]', r.status(), r.url()); });

await page.goto('https://outil.monsitehq.com/admin/login');
await new Promise(r => setTimeout(r, 1000));
await page.type('input[name=email]', 'admin@lamidetlm.com');
await page.type('input[name=password]', 'admin-978a833bd8c32b7a');
await Promise.all([page.click('button[type=submit]'), page.waitForNavigation()]);
await new Promise(r => setTimeout(r, 4000));

const rowCount = await page.evaluate(() => document.querySelectorAll('.row-checkbox').length);
console.log('Rows in table:', rowCount);

await page.screenshot({ path: 'admin-debug.jpg', type: 'jpeg', quality: 80 });
await browser.close();
console.log('OK');
