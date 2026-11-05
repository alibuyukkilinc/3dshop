import { quatY, rng } from './math.js';
import type { Component, Material, SceneDocument, SceneNode, Vec3 } from './schema.js';

/**
 * Motor prototipi (K20) ölçüm sahnesi: bir sokak, iki mağaza, tramvay ve durak, 50 ürün panosu, sokak lambaları,
 * ağaçlar, arka plan binaları. Gerçek varlıklar F3'te gelir; burada geometri ilkelleri kullanılır.
 * Deterministiktir: aynı tohum her motorda birebir aynı belgeyi üretir.
 */
export interface TestSceneStats {
  nodes: number;
  primitives: number;
  boards: number;
}

const mat = (color: string, extra: Partial<Material> = {}): Material => ({
  color,
  roughness: 0.8,
  metalness: 0,
  ...extra,
});

const box = (size: Vec3, material: Material, shadows = true): Component => ({
  type: 'primitive',
  shape: 'box',
  size,
  material,
  castShadow: shadows,
  receiveShadow: true,
});

const PRODUCT_NAMES = [
  'Monokristal Panel 550W',
  'Hibrit İnverter 5kW',
  'LiFePO4 Akü 100Ah',
  'MPPT Şarj Kontrol 40A',
  'Taşınabilir Güç İstasyonu',
  'Solar Kablo 6mm²',
  'Tam Sinüs İnverter 2kW',
  'Panel Montaj Seti',
  'Akıllı Enerji Sayacı',
  'Solar Sulama Pompası',
  'TYT Deneme Seti 10’lu',
  'AYT Matematik Denemesi',
  'LGS Deneme Kitabı',
  'KPSS Genel Yetenek',
  'YDS İngilizce Seti',
];

export function buildTestScene(seed = 20261105): { doc: SceneDocument; stats: TestSceneStats } {
  const rand = rng(seed);
  const nodes: SceneNode[] = [];
  let counter = 0;
  const add = (parent: string | null, name: string, p: Vec3, components: Component[], r = quatY(0)): string => {
    const id = `n${++counter}`;
    nodes.push({ id, parent, name, transform: { p, r, s: [1, 1, 1] }, components });
    return id;
  };

  const root = add(null, 'Enerji Çarşısı (ölçüm sahnesi)', [0, 0, 0], [
    { type: 'light', kind: 'hemispheric', color: '#ffffff', intensity: 0.7, shadows: false },
  ]);
  add(root, 'Güneş', [0, 0, 0], [
    { type: 'light', kind: 'directional', color: '#fff4e0', intensity: 1.6, direction: [-0.5, -1, -0.35], shadows: true },
  ]);

  // Zemin, yol, kaldırımlar, raylar
  add(root, 'Zemin', [0, -0.01, 0], [
    { type: 'primitive', shape: 'plane', size: [160, 80], material: mat('#8a9a7b'), castShadow: false, receiveShadow: true },
  ]);
  add(root, 'Yol', [0, 0.02, 0], [box([140, 0.04, 8], mat('#3d4148'), false)]);
  add(root, 'Kuzey kaldırım', [0, 0.08, -6], [box([140, 0.16, 4], mat('#b9b4aa'), false)]);
  add(root, 'Güney kaldırım', [0, 0.08, 6], [box([140, 0.16, 4], mat('#b9b4aa'), false)]);
  for (const z of [-0.7, 0.7]) add(root, 'Ray', [0, 0.06, z], [box([140, 0.06, 0.12], mat('#777b80', { metalness: 0.8, roughness: 0.4 }), false)]);

  // Tramvay (kapalı rota boyunca hareket eder)
  const tram = add(root, 'Tramvay', [0, 0, 0], [
    { type: 'path_loop', points: [[-60, 1.7, 0], [60, 1.7, 0]], speed: 6 },
  ]);
  add(tram, 'Gövde', [0, 0, 0], [box([12, 3, 2.6], mat('#c8102e'))]);
  add(tram, 'Pencereler', [0, 0.5, 0], [box([11, 1, 2.65], mat('#1d2b3a', { emissive: '#3a5f80', roughness: 0.2 }), false)]);

  // Durak
  const stop = add(root, 'Tramvay durağı', [10, 0.16, -5.6], []);
  add(stop, 'Çatı', [0, 2.6, 0], [box([6, 0.15, 2.4], mat('#2f6f6a'))]);
  for (const x of [-2.8, 2.8]) add(stop, 'Direk', [x, 1.3, -1], [{ type: 'primitive', shape: 'cylinder', size: [0.12, 2.6], material: mat('#444a52'), castShadow: true, receiveShadow: false }]);
  add(stop, 'Bank', [0, 0.45, -0.8], [box([3.5, 0.1, 0.5], mat('#8b5a2b'))]);
  add(stop, 'Durak tabelası', [3.2, 1.6, 0.2], [
    { type: 'board', width: 1.2, height: 0.8, product_id: 'durak', title: 'Enerji Çarşısı', price_text: 'Tramvay T1', color: '#2f6f6a' },
  ]);

  // İki mağaza: açık cepheli kabuk + 3 raf + 25 pano
  let boardCount = 0;
  const store = (name: string, x: number, accent: string) => {
    const s = add(root, name, [x, 0.16, -16], []);
    add(s, 'Taban', [0, 0.05, 0], [box([16, 0.1, 12], mat('#d8d2c4'), false)]);
    add(s, 'Arka duvar', [0, 3, -6], [box([16, 6, 0.3], mat('#e9e4da'))]);
    for (const sx of [-8, 8]) add(s, 'Yan duvar', [sx, 3, 0], [box([0.3, 6, 12], mat('#e9e4da'))]);
    add(s, 'Çatı', [0, 6.1, 0], [box([16.4, 0.3, 12.4], mat('#5b5f66'))]);
    add(s, 'Tabela', [0, 6.9, 6], [
      { type: 'board', width: 8, height: 1.3, product_id: `${name}-tabela`, title: name, price_text: '', color: accent },
    ]);
    for (let shelf = 0; shelf < 3; shelf++) {
      const sz = -4 + shelf * 3.5;
      add(s, 'Raf', [0, 1, sz], [box([12, 2, 0.6], mat('#a9825a'))]);
      const perShelf = shelf === 2 ? 9 : 8;
      for (let i = 0; i < perShelf; i++) {
        const bx = -5.4 + i * (10.8 / (perShelf - 1));
        const name = PRODUCT_NAMES[Math.floor(rand() * PRODUCT_NAMES.length)]!;
        const price = (Math.floor(rand() * 9000) + 499).toLocaleString('tr-TR');
        boardCount++;
        add(s, 'Ürün panosu', [bx, 2.6, sz + 0.31], [
          {
            type: 'board',
            width: 1.2,
            height: 0.9,
            product_id: `p${boardCount}`,
            title: name,
            price_text: `${price} TL`,
            color: accent,
          },
        ]);
      }
    }
  };
  store('Esen Solar Market', -20, '#e8891d');
  store('Deneme Kapsülü', 22, '#2d6cdf');

  // Sokak lambaları
  for (let i = 0; i < 10; i++) {
    for (const z of [-4.4, 4.4]) {
      const lamp = add(root, 'Lamba', [-63 + i * 14, 0.16, z], []);
      add(lamp, 'Direk', [0, 2.2, 0], [{ type: 'primitive', shape: 'cylinder', size: [0.14, 4.4], material: mat('#30353b'), castShadow: true, receiveShadow: false }]);
      add(lamp, 'Ampul', [0, 4.5, 0], [{ type: 'primitive', shape: 'sphere', size: [0.45], material: mat('#fff6d5', { emissive: '#ffe9a8' }), castShadow: false, receiveShadow: false }]);
    }
  }

  // Ağaçlar (güney kaldırım)
  for (let i = 0; i < 18; i++) {
    const t = add(root, 'Ağaç', [-62 + i * 7.3 + rand() * 1.5, 0.16, 7.2], []);
    const h = 2.4 + rand() * 1.2;
    add(t, 'Gövde', [0, h / 2, 0], [{ type: 'primitive', shape: 'cylinder', size: [0.3, h], material: mat('#6b4a2f'), castShadow: true, receiveShadow: false }]);
    add(t, 'Taç', [0, h + 1, 0], [{ type: 'primitive', shape: 'sphere', size: [2.4 + rand()], material: mat('#3f7a3a'), castShadow: true, receiveShadow: false }]);
  }

  // Arka plan binaları
  for (let i = 0; i < 14; i++) {
    const h = 8 + rand() * 18;
    const zSide = i % 2 === 0 ? -30 : 20;
    add(root, 'Bina', [-65 + i * 10, h / 2, zSide - rand() * 6], [box([8 + rand() * 3, h, 8], mat(['#c9c2b6', '#a7b0b8', '#d6c7a8', '#9fa8a3'][i % 4]!))]);
  }

  const doc: SceneDocument = { schema: 'dtd.scene.v1', units: 'm', background: '#bcd3e6', nodes };
  const primitives = nodes.reduce((n, x) => n + x.components.filter((c) => c.type === 'primitive').length, 0);
  const boards = nodes.reduce((n, x) => n + x.components.filter((c) => c.type === 'board').length, 0);
  return { doc, stats: { nodes: nodes.length, primitives, boards } };
}
