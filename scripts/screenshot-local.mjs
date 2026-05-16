import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://localhost:8765/home.html';
const outPath = process.argv[3] || 'C:/Users/lamid/CascadeProjects/bibi-project-site/landing-local-screenshot.png';

const browser = await puppeteer.launch({ headless: 'new', defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
console.log('loading:', url);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000)); // settle web fonts
await page.screenshot({ path: outPath, fullPage: true });
console.log('saved:', outPath);
await browser.close();
