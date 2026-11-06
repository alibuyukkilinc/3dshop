import { BoxGeometry, type BufferGeometry, CylinderGeometry, ExtrudeGeometry, Shape } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Araç geometrileri (görsel iyileştirme 3): binek otomobil ve üç modüllü tramvay. Yan profil çizilip
 * genişliğe doğru pah ile çekilir (yuvarlak kenar), camlar profilden hafif taşan ayrı bir gövdedir. Her
 * araç malzeme başına tek geometri: örnekli çizimde (InstancedMesh) parça başına bir çizim çağrısı.
 * Uzunluk +x yönündedir; araç merkezi (0, 0, 0), zemin y = 0.
 */

export interface CarParts {
  body: BufferGeometry;
  glass: BufferGeometry;
  tyre: BufferGeometry;
  head: BufferGeometry;
  tail: BufferGeometry;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  for (const p of parts) p.dispose();
  return g;
}

/** Binek otomobil: 4,4 m × 1,8 m × 1,45 m (örnek ölçeğiyle sedan/SUV arası değişir) */
export function carParts(): CarParts {
  const s = new Shape();
  s.moveTo(-2.2, 0.32);
  s.lineTo(-2.2, 0.8);
  s.quadraticCurveTo(-2.18, 0.94, -1.95, 0.96);
  s.lineTo(-1.38, 1.0);
  s.quadraticCurveTo(-1.1, 1.4, -0.85, 1.43);
  s.lineTo(0.42, 1.44);
  s.quadraticCurveTo(0.7, 1.4, 1.18, 1.0);
  s.lineTo(1.95, 0.9);
  s.quadraticCurveTo(2.2, 0.86, 2.22, 0.66);
  s.lineTo(2.22, 0.32);
  s.lineTo(-2.2, 0.32);
  const body = new ExtrudeGeometry(s, { depth: 1.66, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2, curveSegments: 4 });
  body.translate(0, 0, -0.83);

  // Cam: kabin profili, gövdenin hemen dışında (yanlar, ön ve arka cam); tavan gövde renginde kalır
  const g = new Shape();
  g.moveTo(-1.42, 0.98);
  g.quadraticCurveTo(-1.13, 1.38, -0.86, 1.39);
  g.lineTo(0.43, 1.4);
  g.quadraticCurveTo(0.7, 1.37, 1.23, 0.98);
  g.lineTo(-1.42, 0.98);
  const glass = new ExtrudeGeometry(g, { depth: 1.84, bevelEnabled: false, curveSegments: 4 });
  glass.translate(0, 0, -0.92);

  const tyres: BufferGeometry[] = [];
  for (const x of [-1.38, 1.36])
    for (const z of [-0.8, 0.8]) tyres.push(new CylinderGeometry(0.33, 0.33, 0.24, 10).rotateX(Math.PI / 2).translate(x, 0.33, z));
  const head = merge([-0.62, 0.62].map((z) => new BoxGeometry(0.06, 0.12, 0.38).translate(2.27, 0.72, z)));
  const tail = merge([-0.66, 0.66].map((z) => new BoxGeometry(0.06, 0.14, 0.34).translate(-2.25, 0.82, z)));
  return { body, glass, tyre: merge(tyres), head, tail };
}

export interface TramParts {
  body: BufferGeometry;
  glass: BufferGeometry;
  accent: BufferGeometry;
  dark: BufferGeometry;
  lights: BufferGeometry;
}

/** Üç modüllü alçak tabanlı tramvay: 27 m, iki yönlü burun, bant cam, kapılar, körükler, pantograf */
export function tramParts(): TramParts {
  const L = 13.5;
  const s = new Shape();
  s.moveTo(-L + 1.1, 0.38);
  s.lineTo(L - 1.1, 0.38);
  s.quadraticCurveTo(L, 0.38, L, 1.3);
  s.lineTo(L, 2.3);
  s.quadraticCurveTo(L - 0.1, 3.3, L - 1.2, 3.35);
  s.lineTo(-L + 1.2, 3.35);
  s.quadraticCurveTo(-L + 0.1, 3.3, -L, 2.3);
  s.lineTo(-L, 1.3);
  s.quadraticCurveTo(-L, 0.38, -L + 1.1, 0.38);
  const body = new ExtrudeGeometry(s, { depth: 2.5, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 10 });
  body.translate(0, 0, -1.25);

  const W = 2.7;
  // Yan bant cam + iki uçta ön cam
  const glass = merge([
    new BoxGeometry(2 * L - 2.2, 1.45, W).translate(0, 1.98, 0),
    new BoxGeometry(0.5, 1.15, 2.3).translate(L - 0.12, 2.05, 0),
    new BoxGeometry(0.5, 1.15, 2.3).translate(-L + 0.12, 2.05, 0),
  ]);

  // Renk şeridi (alt ve çatı altı) ve burun maskesi
  const accent = merge([new BoxGeometry(2 * L - 1.6, 0.3, W).translate(0, 0.66, 0), new BoxGeometry(2 * L - 2.6, 0.1, W).translate(0, 2.84, 0)]);

  const dark: BufferGeometry[] = [];
  // Kapılar (her modülde iki, iki yanda): koyu camlı çift kanat
  for (const x of [-10.6, -7.2, -1.7, 1.7, 7.2, 10.6]) dark.push(new BoxGeometry(1.3, 2.25, W + 0.02).translate(x, 1.55, 0));
  // Modül körükleri
  for (const x of [-4.5, 4.5]) dark.push(new BoxGeometry(0.35, 2.95, 2.62).translate(x, 1.86, 0));
  // Etek (boji örtüsü) ve çatı ekipmanı
  dark.push(new BoxGeometry(2 * L - 2.8, 0.22, 2.3).translate(0, 0.3, 0));
  for (const x of [-9, 0, 9]) dark.push(new BoxGeometry(3.2, 0.32, 1.7).translate(x, 3.58, 0));
  // Pantograf (orta modül): eşkenar dörtgen kollar, temas çubuğu ~5,9 m'de katener teline değer
  const arm = (x: number, y: number, len: number, rot: number) => new BoxGeometry(len, 0.05, 0.05).rotateZ(rot).translate(x, y, 0);
  dark.push(arm(-0.55, 4.18, 1.4, 0.95), arm(0.55, 4.18, 1.4, -0.95), arm(-0.55, 5.3, 1.4, -0.95), arm(0.55, 5.3, 1.4, 0.95));
  dark.push(new BoxGeometry(0.1, 0.06, 1.6).translate(0, 5.86, 0));
  const lights = merge([L + 0.06, -L - 0.06].flatMap((x) => [-0.75, 0.75].map((z) => new BoxGeometry(0.06, 0.14, 0.32).translate(x, 0.95, z))));
  return { body, glass, accent, dark: merge(dark), lights };
}
