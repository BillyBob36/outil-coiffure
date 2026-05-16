import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelPath = resolve('C:/Users/lamid/CascadeProjects/bibi-project-site/maquickpagemodel.html');
const outPath = resolve('C:/Users/lamid/CascadeProjects/bibi-project-site/maquickpagemodel-screenshot.png');
const url = 'file:///' + modelPath.replace(/\\/g, '/');

const browser = await puppeteer.launch({ headless: 'new', defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
console.log('loading:', url);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: outPath, fullPage: true });
console.log('saved:', outPath);
await browser.close();
