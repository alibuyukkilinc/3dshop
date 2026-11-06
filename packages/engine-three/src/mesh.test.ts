import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { buildScene } from './build-scene.js';

describe('mesh bileşeni (F3.4)', () => {
  it('yükleyiciyle model düğüme eklenir; lod_policy ve autoLod uygulanır; ready bekler', async () => {
    const calls: string[] = [];
    const built = buildScene(
      {
        schema: 'dtd.scene.v1',
        units: 'm',
        background: '#000000',
        nodes: [
          { id: 'a', parent: null, transform: { p: [1, 0, 2], r: [0, 0, 0, 1], s: [1, 1, 1] }, components: [{ type: 'mesh', asset_version_id: '01960000-0000-7000-8000-0000000000aa', lod_policy: 'auto' }] },
          { id: 'b', parent: null, transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, components: [{ type: 'mesh', asset_version_id: '01960000-0000-7000-8000-0000000000bb', lod_policy: 'low' }] },
        ],
      },
      {
        shadows: true,
        autoLod: 'lod1',
        meshLoader: async (id, lod) => {
          calls.push(`${id.slice(-2)}:${lod}`);
          if (id.endsWith('bb')) return null;
          const g = new Group();
          g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
          return g;
        },
      },
    );
    await built.ready;
    expect(calls.sort()).toEqual(['aa:lod1', 'bb:lod2']);
    const a = built.nodes.get('a')!;
    expect(a.children).toHaveLength(1);
    expect((a.children[0]!.children[0] as Mesh).castShadow).toBe(true);
    expect(built.nodes.get('b')!.children).toHaveLength(0);
  });
});
