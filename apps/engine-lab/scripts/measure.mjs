// Motor laboratuvarını ekran kartı açık bir Chromium'da çalıştırıp sonuçları toplar (K20).
// Önce: pnpm --filter @dtd/engine-lab build && pnpm --filter @dtd/engine-lab exec vite preview --port 5175
// Sonra: node scripts/measure.mjs [taban-adres]   (varsayılan http://localhost:5175/lab/)
// Her durum ayrı, taze bir sayfada ve sırası karıştırılarak 2 kez ölçülür; ortanca alınır.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5175/lab/';
const cases = [
  ['babylon', 1],
  ['three', 1],
  ['babylon', 0],
  ['three', 0],
];
const RUNS = 2;

const browser = await chromium.launch({
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const results = [];
for (let run = 0; run < RUNS; run++) {
  for (const [engine, shadows] of run % 2 ? [...cases].reverse() : cases) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const bytes = { js: 0, total: 0 };
    page.on('response', async (res) => {
      const len = Number(res.headers()['content-length'] ?? 0) || (await res.body().catch(() => Buffer.alloc(0))).length;
      bytes.total += len;
      if (res.url().endsWith('.js')) bytes.js += len;
    });
    await page.goto(`${base}${engine}.html?shadows=${shadows}&dpr=1`);
    const r = await page.waitForFunction(() => window.__benchResult, null, { timeout: 90_000, polling: 500 }).then((h) => h.jsonValue());
    results.push({ ...r, run, transferred_js_kb: Math.round(bytes.js / 1024) });
    console.log(`${r.engine.padEnd(10)} gölge=${shadows} çalıştırma=${run}: ${r.fps_avg} FPS (p5 ${r.fps_p5}), ilk kare ${r.first_frame_ms} ms, çağrı ${r.draw_calls}, GPU ${r.gpu.slice(0, 60)}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(new URL('../measure-results.json', import.meta.url), JSON.stringify(results, null, 2));
