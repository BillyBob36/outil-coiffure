import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });

// Login
await page.goto('https://outil-coiffure.lamidetlm.com/admin/login');
await new Promise(r => setTimeout(r, 800));
await page.type('input[name=email]', 'admin@lamidetlm.com');
await page.type('input[name=password]', 'admin-978a833bd8c32b7a');
await page.click('button[type=submit]');
await page.waitForNavigation();
await new Promise(r => setTimeout(r, 2500));

// Screenshot full admin
await page.screenshot({ path: 'admin-full.jpg', type: 'jpeg', quality: 80 });

// Test export Smartlead
const { ok, headers, sample } = await page.evaluate(async () => {
  const r = await fetch('/admin/export-csv?format=smartlead', { credentials: 'same-origin' });
  const text = await r.text();
  return {
    ok: r.ok,
    headers: text.split('\n')[0],
    sample: text.split('\n').slice(1, 3).join('\n')
  };
});
console.log('Export Smartlead OK:', ok);
console.log('Headers:', headers);
console.log('Sample:\n' + sample.slice(0, 500));

// Test groups API
const groups = await page.evaluate(async () => {
  const r = await fetch('/api/groups', { credentials: 'same-origin', headers: { Accept: 'application/json' }});
  return r.json();
});
console.log('Groups:', JSON.stringify(groups));

await browser.close();
