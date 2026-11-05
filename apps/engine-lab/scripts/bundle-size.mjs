// Derleme sonrası her motor sayfasının yüklediği JavaScript'in ham ve gzip boyutunu yazar (K20 ölçütü).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const out = {};
for (const page of ['babylon', 'three']) {
  const html = readFileSync(join(dist, `${page}.html`), 'utf8');
  const files = [...html.matchAll(/(?:src|href)="\/lab\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  let raw = 0;
  let gz = 0;
  for (const f of new Set(files)) {
    const buf = readFileSync(join(dist, f));
    raw += buf.length;
    gz += gzipSync(buf, { level: 9 }).length;
  }
  out[page] = { files: [...new Set(files)], raw_kb: Math.round(raw / 1024), gzip_kb: Math.round(gz / 1024) };
}
writeFileSync(join(dist, 'bundle-size.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
