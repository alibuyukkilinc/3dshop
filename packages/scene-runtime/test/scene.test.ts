import { describe, expect, it } from 'vitest';
import { BENCH_DURATION_S, SceneDocumentSchema, buildTestScene, cameraAt, dist3, pointOnLoop } from '../src/index.js';

describe('dtd.scene.v1 ölçüm sahnesi (K20, K45)', () => {
  it('şemaya uyar; 50 ürün panosu ve beklenen ölçek', () => {
    const { doc, stats } = buildTestScene();
    expect(() => SceneDocumentSchema.parse(doc)).not.toThrow();
    const productBoards = doc.nodes.filter((n) => n.components.some((c) => c.type === 'board' && c.product_id.startsWith('p')));
    expect(productBoards).toHaveLength(50);
    // ~118 ilkel + 53 pano: gerçekçi bir bölgenin çizim yükü (mesh başına bir çizim çağrısı, örnekleme yok)
    expect(stats.primitives + stats.boards).toBeGreaterThan(150);
    expect(stats.nodes).toBeLessThan(400);
  });

  it('deterministiktir: aynı tohum aynı belge', () => {
    expect(JSON.stringify(buildTestScene(7).doc)).toBe(JSON.stringify(buildTestScene(7).doc));
    expect(JSON.stringify(buildTestScene(7).doc)).not.toBe(JSON.stringify(buildTestScene(8).doc));
  });

  it('ebeveyn sonra gelirse ya da kimlik yinelenirse reddeder', () => {
    const doc = buildTestScene().doc;
    const bad = { ...doc, nodes: [{ ...doc.nodes[1]!, parent: 'yok' }, ...doc.nodes] };
    expect(() => SceneDocumentSchema.parse(bad)).toThrow(/Ebeveyn/);
    const dup = { ...doc, nodes: [...doc.nodes, doc.nodes[0]!] };
    expect(() => SceneDocumentSchema.parse(dup)).toThrow(/Yinelenen/);
  });

  it('kamera rotası süreklidir (ani sıçrama yok)', () => {
    let prev = cameraAt(0).pos;
    for (let t = 0.05; t <= BENCH_DURATION_S; t += 0.05) {
      const p = cameraAt(t).pos;
      expect(dist3(prev, p)).toBeLessThan(1.5);
      prev = p;
    }
  });

  it('kapalı rota üzerinde nokta', () => {
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [10, 0, 0],
    ];
    expect(pointOnLoop(pts, 5)).toEqual([5, 0, 0]);
    expect(pointOnLoop(pts, 15)).toEqual([5, 0, 0]);
  });
});
