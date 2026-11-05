// Mimari kural testlerinin örnek dosyalarını üretir (bir kez çalıştırıldı; fixtures/ depoya girer).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/apps/api/src/modules');
const files = {
  'commerce/public/index.ts': 'export const brand = 1;\n',
  'world/public/index.ts': 'export const place = 1;\n',
  'catalog/domain/product.ts': 'export const product = 1;\n',
  'catalog/public/index.ts': "import { brand } from '../../commerce/public/index';\nexport const p = brand;\n",
  'rules/application/bad-internal.ts':
    "import { product } from '../../catalog/domain/product';\nexport const r = product;\n",
  'publishing/application/bad-direction.ts':
    "import { place } from '../../world/public/index';\nexport const x = place;\n",
  'unknownmod/a.ts': "import { brand } from '../commerce/public/index';\nexport const u = brand;\n",
};
for (const [rel, body] of Object.entries(files)) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}
