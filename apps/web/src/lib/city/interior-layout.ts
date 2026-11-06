import type { Obstacle, V2 } from './movement';

/**
 * Mağaza iç mekânı yerleşimi (K64), saf hesap: koridor rafları (gondol), raf yüzlerine ürün dağıtımı, oda
 * ölçüleri, öne çıkan standlar, çarpışma noktaları. Çizim interior.ts'de.
 *
 * Koordinatlar: ön duvar (giriş kapısı) z = 0, oda −z yönünde uzanır; x ortada 0.
 */
export const SHELF = {
  /** Bir raf yüzünde sütun ve kat */
  cols: 12,
  rows: 3,
  /** Ürün kartı aralığı (m) */
  pitch: 0.56,
  /** Gondol boyu (m) = cols × pitch + kenar payı */
  length: 12 * 0.56 + 0.3,
  /** Gondol ekseni arası (koridor genişliği dahil) */
  spacing: 3.1,
  /** Yüz düzleminin gondol ekseninden uzaklığı (rafın ortası) */
  faceOffset: 0.19,
  /** Kat tabanları (raf üst yüzü) */
  levels: [0.32, 0.82, 1.32] as const,
  rowHeight: 0.5,
} as const;
export const FACE_CAPACITY = SHELF.cols * SHELF.rows;

const FRONT_ZONE = 7.5; // giriş + öne çıkanlar
const BACK_MARGIN = 2.6;
const SIDE_MARGIN = 2.4;
const MIN_WIDTH = 14;

export interface FaceLayout<T> {
  index: number;
  label: string;
  /** Bölümün sırası (renk için) */
  section: number;
  /** Yüz düzleminin merkezi (dünya, iç mekân sahnesi) */
  center: [number, number, number];
  /** Düzlemin baktığı yön: +1 → +x, −1 → −x */
  side: 1 | -1;
  products: T[];
}

export interface InteriorLayout<T> {
  width: number;
  depth: number;
  gondolas: { x: number; z: number }[];
  faces: FaceLayout<T>[];
  /** Öne çıkan standlar: konum ve bakış (rotY) */
  featured: { x: number; z: number; rotY: number }[];
  /** İçeri girişte göz konumu ve bakış */
  spawn: { x: number; z: number; yaw: number };
  /** Çıkış: bu kutuya girilince şehre dönülür */
  exit: { minX: number; maxX: number; minZ: number };
  bounds: { min: V2; max: V2 };
  obstacles: Obstacle[];
  /** Gondolların girişe bakan ucu (z): koridorlar bunun gerisinde */
  aisleFront: number;
}

export function layoutInterior<T>(sections: { label: string; products: T[] }[], featuredCount: number): InteriorLayout<T> {
  // Her bölüm kendi yüzlerine (kapasite 36); bir gondolun iki yüzü farklı bölümlere ait olabilir
  const faceItems: { label: string; section: number; products: T[] }[] = [];
  sections.forEach((s, si) => {
    for (let k = 0; k < s.products.length; k += FACE_CAPACITY) {
      faceItems.push({ label: s.label, section: si, products: s.products.slice(k, k + FACE_CAPACITY) });
    }
  });
  const gondolaCount = Math.max(1, Math.ceil(faceItems.length / 2));
  // Öne çıkanlar yan başına n stand, 2,8 m aralıkla; oda bunları da sığdırmalı
  const perSide = Math.ceil(featuredCount / 2);
  const featuredWidth = perSide ? 2 * (2.6 + (perSide - 1) * 2.8 + 1.6) : 0;
  const width = Math.max(MIN_WIDTH, gondolaCount * SHELF.spacing + SIDE_MARGIN * 2, featuredWidth);
  const depth = FRONT_ZONE + SHELF.length + BACK_MARGIN;
  const zc = -(FRONT_ZONE + SHELF.length / 2);
  const gondolas = Array.from({ length: gondolaCount }, (_, i) => ({ x: (i - (gondolaCount - 1) / 2) * SHELF.spacing, z: zc }));

  // Yüz sırası: soldan sağa, her gondolda önce −x sonra +x yüzü (koridorda karşılıklı iki bölüm görünür)
  const faces: FaceLayout<T>[] = faceItems.map((f, i) => {
    const g = gondolas[Math.floor(i / 2)]!;
    const side: 1 | -1 = i % 2 === 0 ? -1 : 1;
    return { index: i, label: f.label, section: f.section, center: [g.x + side * SHELF.faceOffset, SHELF.levels[0] + (SHELF.rows * SHELF.rowHeight) / 2, g.z], side, products: f.products };
  });

  // Öne çıkanlar: orta yürüme yolunun iki yanında, girişe bakan iki sıra
  const featured: InteriorLayout<T>['featured'] = [];
  for (let k = 0; k < featuredCount; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const j = Math.floor(k / 2);
    // Orta yürüme yolunun kenarından (2,6 m) dışa doğru 2,8 m aralık (pano 2,4 m)
    featured.push({ x: side * (2.6 + j * 2.8), z: -4.2, rotY: 0 });
  }

  const obstacles: Obstacle[] = [];
  for (const g of gondolas) {
    for (let z = g.z - SHELF.length / 2 + 0.3; z <= g.z + SHELF.length / 2 - 0.3; z += 0.5) obstacles.push({ x: g.x, z, r: 0.5 });
  }
  // Vitrin podyumu (yarıçap 0,66 m)
  for (const f of featured) obstacles.push({ x: f.x, z: f.z, r: 0.8 });

  return {
    width,
    depth,
    gondolas,
    faces,
    featured,
    spawn: { x: 0, z: -1.6, yaw: 0 },
    exit: { minX: -1.1, maxX: 1.1, minZ: -0.55 },
    bounds: { min: [-width / 2 + 0.45, -depth + 0.45], max: [width / 2 - 0.45, -0.3] },
    obstacles,
    aisleFront: -FRONT_ZONE,
  };
}

/**
 * Bir raf hücresinin dünya konumu (yüz düzleminde, hücre ortası). Yüz düzlemi rotateY(±90°) ile döndürülür:
 * +x yüzünde doku u'su −z yönüne, −x yüzünde +z yönüne ilerler.
 */
export function cellCenter(face: { center: [number, number, number]; side: 1 | -1 }, index: number): [number, number, number] {
  const col = index % SHELF.cols;
  const row = Math.floor(index / SHELF.cols);
  const lx = (col + 0.5) * SHELF.pitch - (SHELF.cols * SHELF.pitch) / 2;
  const ly = (SHELF.rows * SHELF.rowHeight) / 2 - (row + 0.5) * SHELF.rowHeight;
  return [face.center[0], face.center[1] + ly, face.center[2] + (face.side > 0 ? -lx : lx)];
}

/** Bir noktaya bakan yaw (kamera −z'ye bakarken yaw = 0) */
export function yawTo(from: V2, to: V2): number {
  return Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));
}

/** Vitrin podyumlarının ortadaki yürüme yolu: |x| bunun altında podyum yok (ilk podyum 2,6 m, yarıçap 0,8) */
const CENTER_WALK = 1.3;
const PODIUM_CLEAR = 0.95;

/**
 * Mağaza içinde kendiliğinden yürüme yolu (arama, koridor kısayolu): raf ve podyum içinden geçilmez. Her uç
 * önce "ana yol"a (gondol ön ucunun 1 m önü) çıkar; podyum sırasının önündeyse ortadaki yürüme yolundan
 * geçer. Aynı koridorda ya da ikisi de podyumların önündeyse doğrudan gidilir.
 */
export function aislePath(from: V2, to: V2, frontZ: number, podiumZ: number | null = null): V2[] {
  const lane = frontZ + 1;
  const inAisles = (p: V2) => p[1] < frontZ + 0.3;
  const front = (p: V2) => podiumZ !== null && p[1] > podiumZ + PODIUM_CLEAR;
  if (inAisles(from) && inAisles(to) && Math.abs(from[0] - to[0]) < 0.4) return [to];
  if (front(from) && front(to)) return [to];
  if (!inAisles(from) && !inAisles(to) && !front(from) && !front(to)) return [to];
  // Uçtan ana yola: podyumların önündeyse ortaya kayıp ortadan geçer
  const toLane = (p: V2): V2[] => (front(p) && Math.abs(p[0]) > CENTER_WALK ? [[0, p[1]], [0, lane]] : [[p[0], lane]]);
  const pts = [...toLane(from), ...toLane(to).reverse(), to];
  // Ardışık aynı noktalar ayıklanır
  return pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1]![0], p[1] - pts[k - 1]![1]) > 0.01);
}

/** Yüz düzlemindeki doku koordinatından (u, v ∈ 0…1) ürün sırası; boş hücre null */
export function productIndexAt(u: number, v: number, count: number): number | null {
  const col = Math.min(SHELF.cols - 1, Math.max(0, Math.floor(u * SHELF.cols)));
  // v: alt 0, üst 1; üst kat ilk satır
  const row = Math.min(SHELF.rows - 1, Math.max(0, Math.floor((1 - v) * SHELF.rows)));
  const i = row * SHELF.cols + col;
  return i < count ? i : null;
}
