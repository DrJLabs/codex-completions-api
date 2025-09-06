import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const svgs = [
  resolve(__dirname, '../docs/architecture.svg'),
  resolve(__dirname, '../docs/dev-modes.svg'),
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

for (const svgPath of svgs) {
  const pngPath = svgPath.replace(/\.svg$/i, '.png');
  const url = pathToFileURL(svgPath).href;
  const html = `<!doctype html><meta charset=utf-8><body style=margin:0;display:flex;align-items:center;justify-content:center;background:#fff><img id=img src="${url}" style="max-width:100%;max-height:100%"></body>`;
  await page.setContent(html, { waitUntil: 'load' });
  const img = page.locator('#img');
  await img.waitFor({ state: 'visible', timeout: 10000 });
  await img.screenshot({ path: pngPath, timeout: 60000 });
  console.log('wrote', pngPath);
}

await browser.close();
