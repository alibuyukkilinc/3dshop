import { SceneDocumentSchema } from '@dtd/scene-runtime/schema';
import { describe, expect, it } from 'vitest';
import { assetVersionIds, documentChecksum, indexNodes } from './scene-index.js';

const q90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // Y ekseninde +90°

const doc = SceneDocumentSchema.parse({
  schema: 'dtd.scene.v1',
  units: 'm',
  nodes: [
    { id: 'root', parent: null, transform: { p: [100, 0, 0], r: q90, s: [2, 2, 2] } },
    { id: 'slot1', parent: 'root', transform: { p: [1, 0, 0] }, components: [{ type: 'slot', slot_id: 's-1' }] },
    { id: 'durak', parent: null, transform: { p: [0, 0, 20] }, components: [{ type: 'anchor', kind: 'station', ref_id: 'place-1' }] },
    {
      id: 'bina',
      parent: null,
      components: [{ type: 'mesh', asset_version_id: '01960000-0000-7000-8000-0000000000aa' }],
    },
  ],
});

describe('sahne düğüm dizini (K45)', () => {
  it('ebeveyn dönüşümü uygulanır (ölçek ve dönme), çapa ve varlık dizinlenir', () => {
    const idx = indexNodes(doc);
    const slot = idx.find((n) => n.nodeId === 'slot1')!;
    // +90° Y dönmesi (1,0,0) → (0,0,-1); ölçek 2; öteleme (100,0,0)
    expect([slot.x, slot.y, slot.z]).toEqual([100, 0, -2]);
    expect(idx.find((n) => n.nodeId === 'durak')).toMatchObject({ kind: 'anchor:station', refId: 'place-1', z: 20 });
    expect(assetVersionIds(doc)).toEqual(['01960000-0000-7000-8000-0000000000aa']);
  });
  it('özet anahtar sırasından bağımsız', () => {
    expect(documentChecksum({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(documentChecksum({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(documentChecksum({ a: 1 })).not.toBe(documentChecksum({ a: 2 }));
  });
});
