// İki motorun aynı andaki görüntüsünü yan yana karşılaştırmak için ekran görüntüleri (K20 görsel eşitlik).
// node scripts/snapshots.mjs [taban-adres]  → snapshots/<motor>-t<sn>.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5175/lab/';
const out = new URL('../snapshots/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
for (const t of [0, 6, 14]) {
  for (const engine of ['babylon', 'three']) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    await page.goto(`${base}${engine}.html?freeze=${t}&dpr=1`);
    await page.waitForTimeout(4000); // gölgelendirici derleme ve gölge haritası
    await page.screenshot({ path: new URL(`${engine}-t${t}.png`, out).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    await page.close();
  }
}
await browser.close();
console.log('tamam');
