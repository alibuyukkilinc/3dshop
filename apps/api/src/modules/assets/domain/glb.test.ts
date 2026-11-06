import { describe, expect, it } from 'vitest';
import { makeGlb } from '../../../../test/support/glb.js';
import { optimizeLods, validateGlb } from './glb.js';

describe('GLB doğrulama (K46: bozuk/zararlı dosya işlenmez)', () => {
  it('geçerli dosya: üçgen, sınırlar, doku raporlanır', async () => {
    const { report } = await validateGlb(await makeGlb(10));
    expect(report).toMatchObject({ ok: true, triangles: 200, textures: [{ width: 512, height: 512, mime: 'image/png' }] });
    expect(report.bounds!.max[0]).toBe(1);
  });
  it('GLB değil, kesik ve dış uri reddedilir', async () => {
    expect((await validateGlb(Buffer.from('<html>merhaba dünya bu bir glb değil</html>'))).report.errors[0]).toContain('GLB değil');
    const good = await makeGlb(4);
    expect((await validateGlb(good.subarray(0, good.length - 10))).report.errors[0]).toContain('kesik');
    const ext = await validateGlb(await makeGlb(4, { externalUri: true }));
    expect(ext.report.ok).toBe(false);
    expect(ext.report.errors.join(' ')).toContain('uri');
  });
});

describe('optimizasyon (Meshopt + WebP, LOD)', () => {
  it('üç LOD: üçgen azalır, dokular WebP ve küçülür, çıktı yeniden doğrulanır', async () => {
    const src = await makeGlb(40);
    const lods = await optimizeLods(src);
    expect(lods.map((l) => l.role)).toEqual(['lod0', 'lod1', 'lod2']);
    expect(lods[0]!.triangles).toBe(3200);
    expect(lods[1]!.triangles).toBeLessThan(lods[0]!.triangles);
    expect(lods[2]!.triangles).toBeLessThan(lods[1]!.triangles);
    const v = await validateGlb(lods[2]!.data);
    expect(v.report.ok).toBe(true);
    expect(v.report.textures[0]).toMatchObject({ width: 256, mime: 'image/webp' });
    expect(lods[0]!.data.length).toBeLessThan(src.length);
  }, 30_000);
});
