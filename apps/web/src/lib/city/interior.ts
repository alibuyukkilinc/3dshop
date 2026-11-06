import { drawBoard } from '@dtd/scene-runtime';
import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { formatMinor } from '../format';
import { buildShowcases, createCellFrame, roundRect } from './interior-fx';
import { drawStoreSign, loadCorsImage } from './store-sign';
import { type InteriorLayout, SHELF, cellCenter, layoutInterior, productIndexAt } from './interior-layout';

/** /api/v1/stores/:slug/interior yanıtı (K64) */
export interface InteriorProduct {
  id: string;
  name: string;
  price: { final_minor: number; list_minor: number; currency: string } | null;
  in_stock: boolean;
  thumb: string | null;
}
export interface InteriorData {
  store: { id: string; slug: string; name: string; company: string; logo_url?: string | null; icon_url?: string | null };
  total: number;
  truncated: boolean;
  featured: (InteriorProduct & { image: string })[];
  sections: { label: string; products: InteriorProduct[] }[];
}

/** Bölüm renkleri (koridor tabelası, fiyat) */
const PALETTE = ['#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#047857', '#0e7490', '#a16207', '#4338ca', '#475569'];
const WALL_H = 4.2;
/** Raf yüzü bu mesafede yüksek çözünürlüğe geçer, şu mesafede geri döner (m) */
const NEAR = 6.5;
const FAR = 9.5;
/** Dokunmatik (telefon/tablet): bellek ve indirme dar; masaüstü daha yüksek çözünürlük */
const COARSE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
/** Yakın yüz: hücre başına masaüstünde ≈ 341 × 304 px, dokunmatikte ≈ 256 × 228 px */
const HI = COARSE ? { w: 3072, h: 684 } : { w: 4096, h: 912 };
/** Raf etiketleri (ön kenardaki fiyat rayı): üç kat, kat başına bir şerit */
const LABEL = COARSE ? { w: 2048, band: 80 } : { w: 3072, band: 112 };
/** Etiket rayı: raf üst yüzünün 3,5 cm altından 6 cm üstüne */
const RAIL = { below: 0.035, above: 0.06, front: 0.445 };
/** Aynı anda yüksek çözünürlükte en çok bu kadar raf yüzü (koridorda karşılıklı iki yüz + komşular) */
const MAX_HI = 4;
const LO = { w: 768, h: 171 };

/** Yakın raf hücresi için kaynak CDN'in orta boy görseli (_low ≈ 200 px yakında bulanık) */
function mediumOf(thumb: string): string {
  return thumb.replace(/_low\.(\w+)$/, '_medium.$1');
}

/** Görsel önbelleği: aynı küçük görsel bir kez indirilir (kaynak CDN CORS açık; K41) */
const images = new Map<string, HTMLImageElement | 'error'>();
function loadImage(url: string, onReady: (img: HTMLImageElement) => void, onError?: () => void) {
  const c = images.get(url);
  if (c === 'error') return onError?.();
  if (c) {
    if (c.complete && c.naturalWidth > 0) onReady(c);
    else {
      c.addEventListener('load', () => onReady(c), { once: true });
      if (onError) c.addEventListener('error', onError, { once: true });
    }
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.addEventListener('load', () => onReady(img), { once: true });
  img.addEventListener(
    'error',
    () => {
      images.set(url, 'error');
      onError?.();
    },
    { once: true },
  );
  images.set(url, img);
  img.src = url;
}

interface Face {
  mesh: Mesh;
  products: InteriorProduct[];
  color: string;
  center: [number, number, number];
  hi: boolean;
  canvas: HTMLCanvasElement;
  tex: Texture;
  dirty: boolean;
  /** Ürün kimliği → sepetteki adet (tüm yüzlerde ortak) */
  cart: Map<string, number>;
}

/** Bir ürünün iç mekândaki yeri: raf hücresi ya da vitrin podyumu */
export interface ProductSpot {
  /** Ürünün dünya konumu (hücre ortası ya da podyum kartı) */
  point: [number, number, number];
  /** Ürünün baktığı yatay birim yön (bakan kişi bunun önünde durur) */
  facing: [number, number];
}

export interface Interior {
  scene: Scene;
  layout: InteriorLayout<InteriorProduct>;
  data: InteriorData;
  /** Ürün seçilebilir nesneler (raf yüzleri ve standlar) */
  pickables: Object3D[];
  /** Raycast isabetinden ürün kimliği */
  productAt(obj: Object3D, uv: { x: number; y: number } | undefined): string | null;
  /** Her kare: göz konumuna göre raf ayrıntısı, efekt canlandırması (t: saniye) */
  update(x: number, z: number, t: number): void;
  /** Fare üstündeki ürün: hücre çerçevesi yanar (null: söner); ürün kimliği döner */
  hover(obj: Object3D | null, uv: { x: number; y: number } | undefined): string | null;
  /** Seçili ürün: hücresi nabız gibi atan çerçeveyle işaretlenir */
  select(productId: string | null): void;
  /** Ürünün yeri (arama/sepetten ürüne yürüme) */
  locate(productId: string): ProductSpot | null;
  /** Bölümün ilk raf yüzü (koridor kısayolu) */
  sectionSpot(section: number): ProductSpot | null;
  /** Sepetteki ürünler raflarda rozetle görünür */
  setCart(qty: Map<string, number>): void;
  dispose(): void;
}

export function buildInterior(data: InteriorData, opts: { environment: Texture | null; accent: string }): Interior {
  const layout = layoutInterior(data.sections, data.featured.length);
  const scene = new Scene();
  scene.background = new Color('#6f7378');
  scene.environment = opts.environment;
  scene.environmentIntensity = 0.3;
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const { width: W, depth: D } = layout;

  // Işık: sıcak mağaza aydınlatması, gölgesiz (performans). Koyu tavan ve antrasit raflar beyaz ürün
  // kartlarını öne çıkarır; yarıküre ölçülü (fazlası her yüzü eşitleyip sahneyi soluklaştırır)
  scene.add(new HemisphereLight('#fff6ec', '#9a8b78', 1.25));
  const key = new DirectionalLight('#ffeedd', 1.45);
  key.position.set(4, 10, 3);
  scene.add(key);
  const fill = new DirectionalLight('#dfe8ff', 0.35);
  fill.position.set(-6, 6, -8);
  scene.add(fill);

  // Döşeme: sıcak meşe parke (açık taş karo sahneyi fazla beyaz yapıyordu)
  const floorTex = own(woodTexture());
  floorTex.repeat.set(W / 2, D / 2);
  const floor = new Mesh(own(new PlaneGeometry(W, D).rotateX(-Math.PI / 2)), own(new MeshStandardMaterial({ map: floorTex, roughness: 0.48, metalness: 0.02 })));
  floor.position.set(0, 0, -D / 2);
  scene.add(floor);

  // Duvarlar (ön duvarda 2,4 m kapı boşluğu), tavan, renk şeridi
  const wallMat = own(new MeshStandardMaterial({ color: '#d8cfc2', roughness: 0.92 }));
  const backMat = own(new MeshStandardMaterial({ color: '#4a5058', roughness: 0.85 }));
  const accentMat = own(new MeshStandardMaterial({ color: opts.accent, roughness: 0.6 }));
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: MeshStandardMaterial) => {
    const m = new Mesh(own(new BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  box(W, WALL_H, 0.2, 0, WALL_H / 2, -D - 0.1, backMat);
  box(0.2, WALL_H, D, -W / 2 - 0.1, WALL_H / 2, -D / 2, wallMat);
  box(0.2, WALL_H, D, W / 2 + 0.1, WALL_H / 2, -D / 2, wallMat);
  const side = (W - 2.4) / 2;
  box(side, WALL_H, 0.2, -1.2 - side / 2, WALL_H / 2, 0.1, wallMat);
  box(side, WALL_H, 0.2, 1.2 + side / 2, WALL_H / 2, 0.1, wallMat);
  box(2.4, WALL_H - 2.6, 0.2, 0, 2.6 + (WALL_H - 2.6) / 2, 0.1, wallMat);
  box(W, 0.35, 0.02, 0, 3.55, -D + 0.01, accentMat);
  box(0.02, 0.35, D, -W / 2 + 0.01, 3.55, -D / 2, accentMat);
  box(0.02, 0.35, D, W / 2 - 0.01, 3.55, -D / 2, accentMat);
  const ceiling = new Mesh(own(new PlaneGeometry(W, D).rotateX(Math.PI / 2)), own(new MeshStandardMaterial({ color: '#b3aea6', emissive: '#3a3833', roughness: 0.95 })));
  ceiling.position.set(0, WALL_H, -D / 2);
  scene.add(ceiling);
  // Tavan ışık panelleri (kendi ışığı)
  const panelMat = own(new MeshStandardMaterial({ color: '#ffffff', emissive: '#fffbef', emissiveIntensity: 1.2 }));
  const panels: BufferGeometry[] = [];
  for (let x = -W / 2 + 2.5; x <= W / 2 - 2.5; x += 3.1) for (let z = -2.5; z >= -D + 2; z -= 3.5) panels.push(new PlaneGeometry(1.2, 0.6).rotateX(Math.PI / 2).translate(x, WALL_H - 0.01, z));
  if (panels.length) {
    scene.add(new Mesh(own(mergeGeometries(panels)!), panelMat));
    for (const p of panels) p.dispose();
  }
  // Çıkış: kapı boşluğunda gün ışığı + tabela
  const daylight = new Mesh(own(new PlaneGeometry(2.4, 2.6)), own(new MeshStandardMaterial({ color: '#dff0ff', emissive: '#dff0ff', emissiveIntensity: 1 })));
  daylight.position.set(0, 1.3, 0.21);
  daylight.rotation.y = Math.PI;
  scene.add(daylight);
  scene.add(signMesh('ÇIKIŞ', '#15803d', 1.4, 0.36, [0, 2.95, -0.02], 0, own));
  // Arka duvarda mağaza tabelası: kaynak sitenin logosu (yoksa adı)
  const backSign = signMesh(data.store.name, opts.accent, Math.min(8, W * 0.55), Math.min(8, W * 0.55) / 4, [0, 2.7, -D + 0.03], 0, own);
  scene.add(backSign);
  if (data.store.logo_url) {
    void loadCorsImage(data.store.logo_url).then((img) => {
      const mat = backSign.material as MeshStandardMaterial;
      const tex = mat.map as CanvasTexture | null;
      if (!img || !tex) return;
      const cv = tex.image as HTMLCanvasElement;
      drawStoreSign(cv.getContext('2d')!, cv.width, cv.height, { name: data.store.name, color: opts.accent, logo: img });
      tex.needsUpdate = true;
    });
  }

  // Gondollar (gerçek market rafı): koyu çerçeve, taban süpürgeliği ve etiket rayları; açık metal tablalar;
  // delikli (pegboard) sırt panosu. Malzeme başına tek birleşik geometri (3 çizim çağrısı)
  const frame: BufferGeometry[] = [];
  const boards: BufferGeometry[] = [];
  const backs: BufferGeometry[] = [];
  const L = SHELF.length;
  const topY = SHELF.levels[2] + SHELF.rowHeight + 0.12;
  for (const g of layout.gondolas) {
    frame.push(new BoxGeometry(0.94, 0.13, L).translate(g.x, 0.065, g.z));
    backs.push(new BoxGeometry(0.04, topY - 0.13, L - 0.06).translate(g.x, 0.13 + (topY - 0.13) / 2, g.z));
    for (const y of SHELF.levels) {
      for (const s of [-1, 1]) {
        boards.push(new BoxGeometry(0.42, 0.03, L - 0.06).translate(g.x + s * 0.235, y - 0.015, g.z));
        // Etiket rayı: tablanın ön kenarında, fiyat etiketinin arkası
        frame.push(new BoxGeometry(0.022, RAIL.below + RAIL.above, L - 0.06).translate(g.x + s * RAIL.front, y + (RAIL.above - RAIL.below) / 2, g.z));
      }
    }
    // Uç dikmeler ve üst kuşak
    for (const e of [-1, 1]) frame.push(new BoxGeometry(0.94, topY, 0.05).translate(g.x, topY / 2, g.z + (e * L) / 2));
    frame.push(new BoxGeometry(0.1, 0.06, L).translate(g.x, topY + 0.03, g.z));
  }
  const pegTex = own(pegboardTexture());
  pegTex.repeat.set(L / 0.5, (topY - 0.13) / 0.5);
  for (const [geos, mat] of [
    [frame, own(new MeshStandardMaterial({ color: '#3a3f45', roughness: 0.55, metalness: 0.3 }))],
    [boards, own(new MeshStandardMaterial({ color: '#b9bec4', roughness: 0.4, metalness: 0.35 }))],
    [backs, own(new MeshStandardMaterial({ map: pegTex, roughness: 0.7, metalness: 0.15 }))],
  ] as const) {
    if (!geos.length) continue;
    scene.add(new Mesh(own(mergeGeometries([...geos])!), mat));
    for (const p of geos) p.dispose();
  }

  // Raf yüzleri: her yüz tek düzlem + tek doku (36 ürün)
  const cart = new Map<string, number>();
  const labelMeshes: Mesh[] = [];
  const faces: Face[] = layout.faces.map((f) => {
    const color = PALETTE[f.section % PALETTE.length]!;
    const canvas = document.createElement('canvas');
    canvas.width = LO.w;
    canvas.height = LO.h;
    const tex = makeTex(canvas);
    // Ürün görselleri ışıksız ve tonlamasız: kaynak sitedeki renkler aynen (ışıklı malzeme + film
    // tonlaması görselleri soldurüyordu). Hafif gri katsayı beyazın parlamasını önler.
    const mat = new MeshBasicMaterial({ map: tex, color: '#f0f0f0', toneMapped: false, transparent: true, alphaTest: 0.02 });
    const geo = new PlaneGeometry(SHELF.cols * SHELF.pitch, SHELF.rows * SHELF.rowHeight).rotateY(f.side > 0 ? Math.PI / 2 : -Math.PI / 2);
    own(geo);
    own(mat);
    const mesh = new Mesh(geo, mat);
    mesh.position.set(...f.center);
    scene.add(mesh);
    // Fiyat etiketleri: rafın ön kenarındaki rayda, kat başına bir şerit (ad + fiyat)
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = LABEL.w;
    labelCanvas.height = LABEL.band * SHELF.rows;
    drawLabels(labelCanvas, f.products, color);
    const labelTex = own(makeTex(labelCanvas));
    const label = new Mesh(own(labelGeometry(f.side)), own(new MeshBasicMaterial({ map: labelTex, toneMapped: false, color: '#f2f2f2' })));
    const gx = f.center[0] - f.side * SHELF.faceOffset;
    label.position.set(gx + f.side * (RAIL.front + 0.0125), 0, f.center[2]);
    scene.add(label);
    // Koridor tabelası: yüzün üstünde, koridora dönük
    scene.add(signMesh(f.label, color, 3.2, 0.5, [f.center[0] + f.side * 0.02, 2.45, f.center[2]], f.side > 0 ? Math.PI / 2 : -Math.PI / 2, own));
    const face: Face = { mesh, products: f.products, color, center: f.center, hi: false, canvas, tex, dirty: false, cart };
    drawFace(face);
    mesh.userData.face = face;
    // Etikete dokunmak da ürünü açar (aynı u/v → hücre eşlemesi)
    label.userData.face = face;
    labelMeshes.push(label);
    return face;
  });

  // Koridor başlıkları: her gondolun girişe bakan ucunda, iki yüzündeki bölümlerin adı (girişten yön bulma)
  layout.gondolas.forEach((g, gi) => {
    const fs = layout.faces.filter((f) => f.index === gi * 2 || f.index === gi * 2 + 1);
    if (!fs.length) return;
    const label = [...new Set(fs.map((f) => f.label))].join(' · ');
    const color = PALETTE[fs[0]!.section % PALETTE.length]!;
    scene.add(signMesh(label, color, 2.7, 0.42, [g.x, 2.3, g.z + SHELF.length / 2 + 0.05], 0, own));
  });

  // Öne çıkanlar: dönen vitrin podyumları (ışık konisi, parıltı)
  const showcases = buildShowcases(data.featured, layout.featured, opts.accent, loadImage);
  scene.add(showcases.root);

  // Hücre vurgusu: üzerine gelinen (sabit) ve seçili (nabız) ürün
  const hoverFrame = createCellFrame(opts.accent, SHELF.pitch * 0.98, SHELF.rowHeight * 0.96);
  const selectFrame = createCellFrame(opts.accent, SHELF.pitch * 1.04, SHELF.rowHeight * 1.02);
  disposables.push(hoverFrame, selectFrame);
  scene.add(hoverFrame.mesh, selectFrame.mesh);
  let selected: string | null = null;

  const where = new Map<string, { face: number; index: number } | { featured: number }>();
  faces.forEach((f, fi) => f.products.forEach((p, i) => where.set(p.id, { face: fi, index: i })));
  data.featured.forEach((p, i) => {
    if (!where.has(p.id)) where.set(p.id, { featured: i });
  });

  const placeFrame = (m: Mesh, fi: number, index: number) => {
    const lf = layout.faces[fi]!;
    const c = cellCenter(lf, index);
    m.position.set(c[0] + lf.side * 0.012, c[1], c[2]);
    m.rotation.set(0, lf.side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    m.visible = true;
  };

  const pickables: Object3D[] = [...faces.map((f) => f.mesh), ...labelMeshes, ...showcases.pickables];

  return {
    scene,
    layout,
    data,
    pickables,
    productAt(obj, uv) {
      for (let cur: Object3D | null = obj; cur; cur = cur.parent) {
        const face = cur.userData.face as Face | undefined;
        if (face && uv) {
          const i = productIndexAt(uv.x, uv.y, face.products.length);
          return i === null ? null : face.products[i]!.id;
        }
        if (typeof cur.userData.productId === 'string') return cur.userData.productId;
      }
      return null;
    },
    update(x, z, t) {
      showcases.tick(t);
      if (selectFrame.mesh.visible) {
        const k = 1 + Math.sin(t * 5) * 0.035;
        selectFrame.mesh.scale.set(k, k, 1);
        (selectFrame.mesh.material as MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 5) * 0.25;
      }
      // Yüksek çözünürlük yalnız en yakın MAX_HI yüze (bellek: yüz başına ≈ 11 MB); sıra eşiği gecikmeli
      const rank = faces.map((f) => ({ f, d: Math.hypot(f.center[0] - x, f.center[2] - z) })).sort((a, b) => a.d - b.d);
      rank.forEach(({ f, d }, i) => {
        if (!f.hi && d < NEAR && i < MAX_HI) setDetail(f, true);
        else if (f.hi && (d > FAR || i >= MAX_HI + 2)) setDetail(f, false);
      });
      for (const f of faces) {
        if (f.dirty) {
          f.tex.needsUpdate = true;
          f.dirty = false;
        }
      }
    },
    hover(obj, uv) {
      let id: string | null = null;
      hoverFrame.mesh.visible = false;
      for (let cur: Object3D | null = obj; cur; cur = cur.parent) {
        const face = cur.userData.face as Face | undefined;
        if (face && uv) {
          const i = productIndexAt(uv.x, uv.y, face.products.length);
          if (i !== null) {
            id = face.products[i]!.id;
            if (id !== selected) placeFrame(hoverFrame.mesh, faces.indexOf(face), i);
          }
          break;
        }
        if (typeof cur.userData.productId === 'string') {
          id = cur.userData.productId;
          break;
        }
      }
      return id;
    },
    select(id) {
      selectFrame.mesh.visible = false;
      selected = id;
      const w = id ? where.get(id) : undefined;
      if (w && 'face' in w) {
        placeFrame(selectFrame.mesh, w.face, w.index);
        hoverFrame.mesh.visible = false;
      }
    },
    locate(id) {
      const w = where.get(id);
      if (!w) return null;
      if ('face' in w) {
        const lf = layout.faces[w.face]!;
        return { point: cellCenter(lf, w.index), facing: [lf.side, 0] };
      }
      const f = layout.featured[w.featured]!;
      return { point: [f.x, 1.62, f.z], facing: [0, 1] };
    },
    sectionSpot(section) {
      const lf = layout.faces.find((f) => f.section === section);
      return lf ? { point: lf.center, facing: [lf.side, 0] } : null;
    },
    setCart(qty) {
      const changed = new Set<string>();
      for (const id of new Set([...cart.keys(), ...qty.keys()])) if (cart.get(id) !== qty.get(id)) changed.add(id);
      cart.clear();
      for (const [k, v] of qty) cart.set(k, v);
      for (const id of changed) {
        const w = where.get(id);
        if (w && 'face' in w) redrawCell(faces[w.face]!, w.index);
      }
    },
    dispose() {
      for (const f of faces) f.tex.dispose();
      showcases.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

function makeTex(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** Yakın/uzak çözünürlük değişimi: tuval yeniden boyutlanır, doku yenilenir (eski bellek bırakılır) */
function setDetail(f: Face, hi: boolean) {
  f.hi = hi;
  const size = hi ? HI : LO;
  f.canvas.width = size.w;
  f.canvas.height = size.h;
  const old = f.tex;
  f.tex = makeTex(f.canvas);
  (f.mesh.material as MeshStandardMaterial).map = f.tex;
  (f.mesh.material as MeshStandardMaterial).needsUpdate = true;
  old.dispose();
  drawFace(f);
  if (hi) {
    f.products.forEach((p, i) => {
      if (!p.thumb) return;
      const ready = (img: HTMLImageElement) => {
        if (!f.hi) return;
        drawCell(f, i, img);
        f.dirty = true;
      };
      const thumb = p.thumb;
      const med = mediumOf(thumb);
      // Önce küçük (önbellekte hazırsa hemen), sonra orta boy; orta boy yoksa küçükte kalınır
      if (med === thumb) return loadImage(thumb, ready);
      loadImage(med, ready, () => loadImage(thumb, ready));
    });
  }
}

function drawFace(f: Face) {
  const ctx = f.canvas.getContext('2d')!;
  ctx.clearRect(0, 0, f.canvas.width, f.canvas.height);
  f.products.forEach((_, i) => redrawCell(f, i));
}

/** Hücreyi yeniden çizer (yakındaysa önbellekteki görselle) */
function redrawCell(f: Face, i: number) {
  const thumb = f.products[i]!.thumb;
  const ok = (c: HTMLImageElement | 'error' | undefined) => (c && c !== 'error' && c.complete && c.naturalWidth > 0 ? c : undefined);
  const cached = f.hi && thumb ? (ok(images.get(mediumOf(thumb))) ?? ok(images.get(thumb))) : undefined;
  drawCell(f, i, cached);
  f.dirty = true;
}

/**
 * Bir raf hücresi: rafta duran ürün paketi. Beyaz paket önyüzü rafın üst yüzüne oturur (alt kenarı etiket
 * rayının arkasında kalır), görsel paketi doldurur; ad ve fiyat ön kenardaki etikettedir.
 */
function drawCell(f: Face, i: number, img?: HTMLImageElement) {
  const ctx = f.canvas.getContext('2d')!;
  const cw = f.canvas.width / SHELF.cols;
  const ch = f.canvas.height / SHELF.rows;
  const col = i % SHELF.cols;
  const row = Math.floor(i / SHELF.cols);
  const p = f.products[i]!;
  ctx.clearRect(col * cw, row * ch, cw, ch);
  // Paket: hücre genişliğinin %86'sı, yüksekliğin %84'ü; tabanı kat tabanında
  const w = cw * 0.86;
  const h = ch * 0.84;
  const x = col * cw + (cw - w) / 2;
  const y = row * ch + ch - h;
  // Arkadaki gölge (derinlik hissi)
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  roundRect(ctx, x + w * 0.03, y + h * 0.02, w, h, w * 0.035);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, w * 0.035);
  ctx.fill();
  const pad = w * 0.05;
  // Alt %12'si rayın arkasında kalır: görsel onun üstünde
  const ih0 = h * 0.86 - pad * 2;
  if (img) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const k = Math.min((w - pad * 2) / img.naturalWidth, ih0 / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    ctx.drawImage(img, x + (w - iw) / 2, y + pad + (ih0 - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = '#e9edf2';
    roundRect(ctx, x + pad, y + pad, w - pad * 2, ih0, w * 0.03);
    ctx.fill();
  }
  // Paket üstünde ışık parıltısı (düz kağıt değil, ambalaj hissi)
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, w * 0.035);
  ctx.fill();
  if (!p.in_stock) {
    ctx.fillStyle = 'rgba(241,245,249,0.6)';
    roundRect(ctx, x, y, w, h, w * 0.035);
    ctx.fill();
  }
  // Sepetteki ürün: köşede adet rozeti (rafta "benim" işareti)
  const qty = f.cart.get(p.id);
  if (qty) {
    const r = Math.round(ch * 0.1);
    const cx = x + w - r * 0.7;
    const cy = y + r * 0.7;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(r * (qty > 1 ? 0.95 : 1.15))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(qty > 9 ? '9+' : qty > 1 ? String(qty) : '✓', cx, cy + 1);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
  }
}

/** Etiket rayı geometrisi: kat başına bir şerit; şerit r, etiket dokusunun r. bandına (üst kat = 0) */
function labelGeometry(side: 1 | -1): BufferGeometry {
  const width = SHELF.cols * SHELF.pitch;
  const h = RAIL.below + RAIL.above;
  const quads: BufferGeometry[] = [];
  for (let r = 0; r < SHELF.rows; r++) {
    const level = SHELF.levels[SHELF.rows - 1 - r]!;
    const q = new PlaneGeometry(width, h);
    const uv = q.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (r + 1 - uv.getY(k)) / SHELF.rows);
    q.translate(0, level + (RAIL.above - RAIL.below) / 2, 0);
    quads.push(q);
  }
  const g = mergeGeometries(quads)!;
  for (const q of quads) q.dispose();
  return g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/** Raf etiketleri: beyaz etiket, sol kenarda bölüm rengi, ürün adı (tek satır) ve büyük fiyat */
function drawLabels(cv: HTMLCanvasElement, products: InteriorProduct[], color: string) {
  const ctx = cv.getContext('2d')!;
  const cw = cv.width / SHELF.cols;
  const bh = cv.height / SHELF.rows;
  ctx.fillStyle = '#2f3439';
  ctx.fillRect(0, 0, cv.width, cv.height);
  products.forEach((p, i) => {
    const col = i % SHELF.cols;
    const row = Math.floor(i / SHELF.cols);
    const x = col * cw + cw * 0.05;
    const y = row * bh + bh * 0.1;
    const w = cw * 0.9;
    const h = bh * 0.8;
    ctx.fillStyle = p.in_stock ? '#ffffff' : '#e5e7eb';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = p.in_stock ? color : '#94a3b8';
    ctx.fillRect(x, y, w * 0.035, h);
    const tx = x + w * 0.07;
    const tw = w * 0.9;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#334155';
    ctx.font = `600 ${Math.round(h * 0.27)}px system-ui, sans-serif`;
    let name = p.name;
    if (ctx.measureText(name).width > tw) {
      while (name.length > 3 && ctx.measureText(`${name}…`).width > tw) name = name.slice(0, -1);
      name = `${name.trimEnd()}…`;
    }
    ctx.fillText(name, tx, y + h * 0.08);
    ctx.font = `800 ${Math.round(h * 0.46)}px system-ui, sans-serif`;
    ctx.fillStyle = p.in_stock ? '#0f172a' : '#64748b';
    const price = !p.in_stock ? 'Stokta yok' : p.price ? formatMinor(p.price.final_minor, p.price.currency) : 'Fiyat sitede';
    ctx.fillText(price, tx, y + h * 0.42, tw);
    if (p.in_stock && p.price && p.price.list_minor > p.price.final_minor) {
      // İndirimli: sağ üstte bölüm renginde küçük işaret
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w - h * 0.4, y);
      ctx.lineTo(x + w, y + h * 0.4);
      ctx.fill();
    }
  });
}

/** Delikli metal sırt panosu (pegboard): 0,5 m'lik karo, 2,5 cm aralıklı delikler */
function pegboardTexture(): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#5d646c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#2b2f34';
  for (let y = 3.2; y < 128; y += 6.4) for (let x = 3.2; x < 128; x += 6.4) {
    ctx.beginPath();
    ctx.arc(x, y, 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new CanvasTexture(cv);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function signMesh(
  text: string,
  color: string,
  w: number,
  h: number,
  pos: [number, number, number],
  rotY: number,
  own: <T extends { dispose(): void }>(x: T) => T,
): Mesh {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.max(64, Math.round((1024 * h) / w));
  drawBoard(cv.getContext('2d')!, cv.width, cv.height, { title: text, price_text: '', color });
  const tex = own(makeTex(cv));
  const m = new Mesh(own(new PlaneGeometry(w, h)), own(new MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.3 })));
  m.position.set(...pos);
  m.rotation.y = rotY;
  return m;
}

/** Meşe parke: rastgele tonlu, eklemleri kaydırılmış tahtalar, ince damar */
function woodTexture(): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const ctx = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = 8;
  const rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 256;
    while (x < 512) {
      const len = 200 + rnd() * 140;
      const l = 0.9 + rnd() * 0.14;
      ctx.fillStyle = `rgb(${Math.round(168 * l)},${Math.round(140 * l)},${Math.round(108 * l)})`;
      ctx.fillRect(x, r * rh, len, rh);
      // Damar
      ctx.strokeStyle = 'rgba(70,42,20,0.10)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const y = r * rh + 4 + rnd() * (rh - 8);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 6, x + len * 0.7, y + (rnd() - 0.5) * 6, x + len, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,24,12,0.35)';
      ctx.fillRect(x, r * rh, 2, rh);
      x += len;
    }
    ctx.fillStyle = 'rgba(40,24,12,0.30)';
    ctx.fillRect(0, r * rh, 512, 1.5);
  }
  const t = new CanvasTexture(cv);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}


