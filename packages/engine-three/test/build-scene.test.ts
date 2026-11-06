import { buildTestScene } from '@dtd/scene-runtime';
import { DataTexture, DirectionalLight, HemisphereLight, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { buildScene } from '../src/build-scene.js';

// Testte tuval yok: pano dokusu yerine boş doku
const boardTexture = () => new DataTexture(new Uint8Array(4), 1, 1);

describe('dtd.scene.v1 → Three.js (K45, K63)', () => {
  it('her ilkel ve pano için bir mesh; ışıklar ve hiyerarşi kurulur', () => {
    const { doc, stats } = buildTestScene();
    const built = buildScene(doc, { shadows: true, boardTexture });
    let meshes = 0;
    let lights = 0;
    built.scene.traverse((o) => {
      if (o instanceof Mesh) meshes++;
      if (o instanceof HemisphereLight || o instanceof DirectionalLight) lights++;
    });
    // Pano = gövde (çerçeve + ayaklar) + yüzler (ön ve arka): iki mesh
    expect(meshes).toBe(stats.primitives + stats.boards * 2);
    expect(lights).toBe(2);
    expect(built.nodes.size).toBe(doc.nodes.length);
    const boards: string[] = [];
    built.scene.traverse((o) => o.userData.productId && boards.push(o.userData.productId));
    expect(new Set(boards.filter((p) => /^p\d+$/.test(p))).size).toBe(50);
    built.dispose();
  });

  it('pano iki yüzden de okunur: arka yüz normali geriye bakar, doku ters çevrilmez (ayna yok)', () => {
    const { doc } = buildTestScene();
    const built = buildScene(doc, { shadows: false, boardTexture });
    let face: Mesh | null = null;
    built.scene.traverse((o) => {
      if (!face && o instanceof Mesh && o.userData.productId && (o.material as { map?: unknown }).map) face = o;
    });
    const geo = (face as unknown as Mesh).geometry;
    const n = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    // İlk dört köşe ön yüz (+Z), sonraki dört arka yüz (−Z)
    expect(n.getZ(0)).toBeCloseTo(1);
    expect(n.getZ(4)).toBeCloseTo(-1);
    // Arka yüz Y ekseninde döndürüldü: sol üst köşe (u=0) dünyada +X tarafında; ayna olsaydı −X'te kalırdı
    const pos = geo.getAttribute('position');
    expect(uv.getX(4)).toBe(0);
    expect(pos.getX(4)).toBeGreaterThan(0);
    built.dispose();
  });

  it('gölge kapalıyken hiçbir nesne gölge üretmez (düşük kalite profili, K12)', () => {
    const built = buildScene(buildTestScene().doc, { shadows: false, boardTexture });
    let casting = 0;
    built.scene.traverse((o) => {
      if ((o as Mesh).castShadow) casting++;
    });
    expect(casting).toBe(0);
  });

  it('zaman uygulanınca tramvay rotada ilerler', () => {
    const { doc } = buildTestScene();
    const built = buildScene(doc, { shadows: false, boardTexture });
    const tramId = doc.nodes.find((n) => n.components.some((c) => c.type === 'path_loop'))!.id;
    const tram = built.nodes.get(tramId)!;
    built.update(0);
    const x0 = tram.position.x;
    built.update(5);
    expect(tram.position.x).toBeCloseTo(x0 + 30, 5);
  });

  it('şemaya uymayan belgeyi reddeder', () => {
    const doc = buildTestScene().doc;
    expect(() => buildScene({ ...doc, nodes: [...doc.nodes, doc.nodes[0]!] }, { shadows: false, boardTexture })).toThrow();
  });
});
