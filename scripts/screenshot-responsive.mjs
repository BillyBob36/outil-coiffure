import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://localhost:8777/home.html';
const outDir = process.argv[3] || 'C:/Users/lamid/CascadeProjects/bibi-project-site';

const VIEWPORTS = [
  { name: 'desktop',  width: 1440, height: 900 },
  { name: 'tablet',   width: 768,  height: 1024 },
  { name: 'mobile',   width: 390,  height: 844 },  // iPhone 14 Pro
];

const browser = await puppeteer.launch({ headless: 'new' });
for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  console.log('loading at', vp.name, vp.width+'x'+vp.height);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  const path = `${outDir}/landing-${vp.name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log('  saved', path);
  await page.close();
}
await browser.close();
