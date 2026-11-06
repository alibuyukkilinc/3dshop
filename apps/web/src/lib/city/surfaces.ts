import {
  type BufferGeometry,
  CanvasTexture,
  Color,
  type Material,
  type Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';
import { type DetailTextures, asphaltTextures, grassTextures, paverTextures, slabTextures } from './textures';

/**
 * Yüzey kiti (görsel iyileştirme 2): asfalt, parke, plak ve çim malzemeleri; dünya koordinatlı UV ile
 * bölge sahnesi ile istemci süsleri arasında dikişsiz döşenir. Bölge sahnelerindeki düz renkli yüzeyler
 * (cadde, kaldırım, zemin) ve Kenney renk atlası (camlar) burada zenginleştirilir. Yalnız istemci çizimi:
 * sahne belgesi (K45) ve bölge paketi (K48) değişmez; editörün seçtiği yüzey rengi malzeme rengi olarak kalır.
 */

export type SurfaceKind = 'asphalt' | 'paver' | 'slab' | 'grass';

/** Doku tekrar boyu (m) */
const SCALE: Record<SurfaceKind, number> = { asphalt: 6, paver: 3, slab: 4, grass: 8 };
const BUMP: Record<SurfaceKind, number> = { asphalt: 1.2, paver: 2.2, slab: 1.4, grass: 0.8 };
const ROUGH: Record<SurfaceKind, number> = { asphalt: 0.93, paver: 0.86, slab: 0.82, grass: 1 };

export interface SurfaceKit {
  /** Verilen renkte yüzey malzemesi (aynı tür + renk paylaşılır) */
  material(kind: SurfaceKind, color: string | Color): MeshStandardMaterial;
  dispose(): void;
}

export function createSurfaceKit(): SurfaceKit {
  const tex = new Map<SurfaceKind, DetailTextures>();
  const mats = new Map<string, MeshStandardMaterial>();
  const get = (k: SurfaceKind) => {
    let t = tex.get(k);
    if (!t) {
      t = k === 'asphalt' ? asphaltTextures() : k === 'paver' ? paverTextures() : k === 'slab' ? slabTextures() : grassTextures();
      tex.set(k, t);
    }
    return t;
  };
  return {
    material(kind, color) {
      const c = typeof color === 'string' ? new Color(color) : color;
      const key = `${kind}:${c.getHexString()}`;
      let m = mats.get(key);
      if (!m) {
        const t = get(kind);
        m = new MeshStandardMaterial({ color: c, map: t.map, bumpMap: t.bump, bumpScale: BUMP[kind], roughness: ROUGH[kind] });
        mats.set(key, m);
      }
      return m;
    },
    dispose() {
      for (const m of mats.values()) m.dispose();
      for (const t of tex.values()) {
        t.map.dispose();
        t.bump.dispose();
      }
    },
  };
}

/** Yüzey türünün UV ölçeği: geometriye dünya x/z'sinden UV yazar (yatay yüzeyler için) */
export function applyWorldUv(geo: BufferGeometry, world: Matrix4, kind: SurfaceKind) {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  if (!pos || !uv) return;
  const v = new Vector3();
  const s = SCALE[kind];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(world);
    uv.setXY(i, v.x / s, -v.z / s);
  }
  uv.needsUpdate = true;
}

/** Düz renkli yüzeyin türü: koyu → asfalt, açık → parke, yeşil → çim, arası → beton plak */
export function classifySurface(color: Color): SurfaceKind {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const hex = color.clone().convertLinearToSRGB();
  const g = hex.g - Math.max(hex.r, hex.b);
  if (g > 0.08 && hsl.s > 0.25) return 'grass';
  const l = 0.2126 * hex.r + 0.7152 * hex.g + 0.0722 * hex.b;
  if (l < 0.42) return 'asphalt';
  if (l > 0.7) return 'paver';
  return 'slab';
}

/** Rengi yarı doygunluğa indirir (çizgi film tonları gerçekçi yüzeye) */
function soften(c: Color, keep: number): Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new Color().setHSL(hsl.h, hsl.s * keep, hsl.l);
}

/**
 * Bölge sahnesini zenginleştirir: düz renkli yatay primitifler (düzlem, ince kutu) yüzey malzemesi alır;
 * GLTF modellerinin renk atlası camlarda parlak/yansıtıcı, cephede daha az doygun hâle gelir.
 * `primitiveRoots`: sahne belgesinde primitif bileşeni olan düğümlerin nesneleri.
 */
export function enhanceRegion(root: Object3D, primitiveRoots: Object3D[], kit: SurfaceKit, atlas: AtlasCache): void {
  root.updateMatrixWorld(true);
  const prim = new Set<Object3D>();
  for (const g of primitiveRoots)
    for (const ch of g.children) {
      const m = ch as Mesh;
      if (!m.isMesh || m.userData.productId) continue;
      prim.add(m);
      const mat = m.material as MeshStandardMaterial;
      if (Array.isArray(m.material) || !mat.isMeshStandardMaterial || mat.map) continue;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      const size = bb.getSize(new Vector3()).multiply(m.getWorldScale(new Vector3()));
      // Yalnız yatay yüzeyler: düzlem ya da 0,5 m'den ince geniş kutu
      if (size.y > 0.5 || Math.min(size.x, size.z) < 1) continue;
      const kind = classifySurface(mat.color);
      applyWorldUv(m.geometry, m.matrixWorld, kind);
      m.material = kit.material(kind, soften(mat.color, 0.45));
      m.receiveShadow = true;
    }
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || prim.has(m) || m.userData.productId) return;
    if (Array.isArray(m.material)) m.material = m.material.map((x) => atlas.enhance(x));
    else m.material = atlas.enhance(m.material);
  });
}

/**
 * Renk atlası iyileştirme önbelleği: kaynak malzeme başına bir kez. Camsı (açık mavi) pikseller koyu
 * renkli, pürüzsüz ve yarı metalik olur → gökyüzünü yansıtır; diğer pikseller hafif soldurulur ve mat kalır.
 * Pürüz (G) ve metallik (B) tek bir dokuda taşınır.
 */
export interface AtlasCache {
  enhance(m: Material): Material;
  dispose(): void;
}

export function createAtlasCache(): AtlasCache {
  const done = new Map<string, Material>();
  const own: { dispose(): void }[] = [];
  const isGlass = (r: number, g: number, b: number) => b >= 185 && b - r >= 28 && g >= r - 4;
  return {
    enhance(src) {
      const sm = src as MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial || !sm.map?.image) return src;
      if (own.includes(sm)) return src;
      const hit = done.get(sm.uuid);
      if (hit) return hit;
      const img = sm.map.image as CanvasImageSource & { width: number; height: number };
      const w = img.width;
      const h = img.height;
      if (!w || !h) return src;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      let data: ImageData;
      try {
        ctx.drawImage(img, 0, 0);
        data = ctx.getImageData(0, 0, w, h);
      } catch {
        done.set(sm.uuid, src);
        return src;
      }
      const orm = document.createElement('canvas');
      orm.width = w;
      orm.height = h;
      const octx = orm.getContext('2d')!;
      const od = octx.createImageData(w, h);
      const p = data.data;
      let glass = 0;
      for (let i = 0; i < p.length; i += 4) {
        const [r, g, b] = [p[i]!, p[i + 1]!, p[i + 2]!];
        od.data[i + 3] = 255;
        if (isGlass(r, g, b)) {
          glass++;
          // Kaplamalı cam: hafif mavi-yeşil ayna; rengini gökyüzü ve karşı binaların yansıması verir
          p[i] = 118;
          p[i + 1] = 138;
          p[i + 2] = 150;
          od.data[i + 1] = 13; // pürüz ≈ 0,05
          od.data[i + 2] = 225; // metallik ≈ 0,88
        } else {
          // Çizgi film doygunluğunu %30 düşür, biraz ısıt (beton/sıva)
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          p[i] = Math.min(255, l + (r - l) * 0.7 + 3);
          p[i + 1] = l + (g - l) * 0.7;
          p[i + 2] = Math.max(0, l + (b - l) * 0.7 - 4);
          od.data[i + 1] = 215; // pürüz ≈ 0,84
          od.data[i + 2] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      octx.putImageData(od, 0, 0);
      const copy = (t: Texture, c: HTMLCanvasElement, srgb: boolean) => {
        const n = new CanvasTexture(c);
        n.flipY = t.flipY;
        n.wrapS = t.wrapS;
        n.wrapT = t.wrapT;
        n.magFilter = t.magFilter;
        n.minFilter = t.minFilter;
        n.anisotropy = 8;
        n.channel = t.channel;
        if (srgb) n.colorSpace = SRGBColorSpace;
        return n;
      };
      const map = copy(sm.map, cv, true);
      const ormTex = copy(sm.map, orm, false);
      const m = new MeshStandardMaterial({
        name: `${sm.name}+`,
        map,
        roughnessMap: ormTex,
        metalnessMap: ormTex,
        roughness: 1,
        metalness: glass ? 1 : 0,
        color: sm.color,
        side: sm.side,
        transparent: sm.transparent,
        opacity: sm.opacity,
        alphaTest: sm.alphaTest,
        vertexColors: sm.vertexColors,
      });
      own.push(m, map, ormTex);
      done.set(sm.uuid, m);
      return m;
    },
    dispose() {
      for (const x of own) x.dispose();
      done.clear();
    },
  };
}
