import { cruise } from 'dependency-cruiser';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../dependency-cruiser.cjs') as { forbidden: unknown[] };
const ALLOWED = require('../module-graph.cjs') as Record<string, string[]>;
const here = dirname(fileURLToPath(import.meta.url));

async function violations(): Promise<string[]> {
  const result = await cruise(['fixtures'], {
    validate: true,
    ruleSet: { forbidden: config.forbidden as never },
    tsPreCompilationDeps: true,
    baseDir: here,
  });
  if (typeof result.output === 'string') throw new Error(result.output);
  return result.output.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`);
}

describe('mimari kuralları (K51)', () => {
  it('izinli yön ve public/ erişimi geçer, ihlaller yakalanır', async () => {
    const found = await violations();
    // catalog -> commerce/public izinli
    expect(found.filter((v) => v.includes('catalog/public/index.ts'))).toEqual([]);
    // rules -> catalog/domain: public/ dışı erişim
    expect(found).toContainEqual(expect.stringContaining('api-module-internal-access'));
    // publishing -> world: izinsiz yön (publishing yalnız çekirdeği bilir)
    expect(found).toContainEqual(expect.stringContaining('api-module-direction-publishing'));
    // tabloda olmayan modül
    expect(found).toContainEqual(expect.stringContaining('api-module-unknown'));
  });

  it('izin listeleri yalnız tanımlı modülleri içerir', () => {
    const mods = Object.keys(ALLOWED);
    for (const deps of Object.values(ALLOWED)) {
      for (const d of deps) expect(mods).toContain(d);
    }
  });
});
