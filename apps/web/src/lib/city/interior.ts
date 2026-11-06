import { buildScene } from '@dtd/engine-three';
import { drawBoard } from '@dtd/scene-runtime';
import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
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
import { type InteriorLayout, SHELF, layoutInterior, productIndexAt } from './interior-layout';

/** /api/v1/stores/:slug/interior yanıtı (K64) */
export interface InteriorProduct {
  id: string;
  name: string;
  price: { final_minor: number; list_minor: number; currency: string } | null;
  in_stock: boolean;
  thumb: string | null;
}
export interface InteriorData {
  store: { id: string; slug: string; name: string; company: string };
  total: number;
  truncated: boolean;
  featured: (InteriorProduct & { image: string })[];
  sections: { label: string; products: InteriorProduct[] }[];
}

/** Bölüm renkleri (koridor tabelası, fiyat) */
const PALETTE = ['#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#047857', '#0e7490', '#a16207', '#4338ca', '#475569'];
const WALL_H = 4.2;
/** Raf yüzü bu mesafede yüksek çözünürlüğe geçer, şu mesafede geri döner (m) */
const NEAR = 7.5;
const FAR = 11;
const HI = { w: 2048, h: 456 };
const LO = { w: 768, h: 171 };

/** Görsel önbelleği: aynı küçük görsel bir kez indirilir (kaynak CDN CORS açık; K41) */
const images = new Map<string, HTMLImageElement | 'error'>();
function loadImage(url: string, onReady: (img: HTMLImageElement) => void) {
  const c = images.get(url);
  if (c === 'error') return;
  if (c) {
    if (c.complete && c.naturalWidth > 0) onReady(c);
    else c.addEventListener('load', () => onReady(c), { once: true });
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.addEventListener('load', () => onReady(img), { once: true });
  img.addEventListener('error', () => images.set(url, 'error'), { once: true });
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
}

export interface Interior {
  scene: Scene;
  layout: InteriorLayout<InteriorProduct>;
  data: InteriorData;
  /** Ürün seçilebilir nesneler (raf yüzleri ve standlar) */
  pickables: Object3D[];
  /** Raycast isabetinden ürün kimliği */
  productAt(obj: Object3D, uv: { x: number; y: number } | undefined): string | null;
  /** Her kare: göz konumuna göre raf ayrıntısı */
  update(x: number, z: number): void;
  dispose(): void;
}

export function buildInterior(data: InteriorData, opts: { environment: Texture | null; accent: string }): Interior {
  const layout = layoutInterior(data.sections, data.featured.length);
  const scene = new Scene();
  scene.background = new Color('#e7e3dc');
  scene.environment = opts.environment;
  scene.environmentIntensity = 0.5;
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const { width: W, depth: D } = layout;

  // Işık: iç mekân aydınlık ve gölgesiz (performans); tavandan yönlü ışık hacim verir. Yarıküre ölçülü:
  // fazlası her yüzü eşitleyip sahneyi düzleştirir (yüksek kalitede derinliği ortam kapanması da verir)
  scene.add(new HemisphereLight('#ffffff', '#b9b0a2', 1.05));
  const key = new DirectionalLight('#fffaf0', 1.6);
  key.position.set(4, 10, 3);
  scene.add(key);

  // Döşeme: açık taş karo
  const floorTex = own(tileTexture());
  floorTex.repeat.set(W / 1.2, D / 1.2);
  const floor = new Mesh(own(new PlaneGeometry(W, D).rotateX(-Math.PI / 2)), own(new MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.05 })));
  floor.position.set(0, 0, -D / 2);
  scene.add(floor);

  // Duvarlar (ön duvarda 2,4 m kapı boşluğu), tavan, renk şeridi
  const wallMat = own(new MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.9 }));
  const accentMat = own(new MeshStandardMaterial({ color: opts.accent, roughness: 0.6 }));
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: MeshStandardMaterial) => {
    const m = new Mesh(own(new BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  box(W, WALL_H, 0.2, 0, WALL_H / 2, -D - 0.1, wallMat);
  box(0.2, WALL_H, D, -W / 2 - 0.1, WALL_H / 2, -D / 2, wallMat);
  box(0.2, WALL_H, D, W / 2 + 0.1, WALL_H / 2, -D / 2, wallMat);
  const side = (W - 2.4) / 2;
  box(side, WALL_H, 0.2, -1.2 - side / 2, WALL_H / 2, 0.1, wallMat);
  box(side, WALL_H, 0.2, 1.2 + side / 2, WALL_H / 2, 0.1, wallMat);
  box(2.4, WALL_H - 2.6, 0.2, 0, 2.6 + (WALL_H - 2.6) / 2, 0.1, wallMat);
  box(W, 0.35, 0.02, 0, 3.55, -D + 0.01, accentMat);
  box(0.02, 0.35, D, -W / 2 + 0.01, 3.55, -D / 2, accentMat);
  box(0.02, 0.35, D, W / 2 - 0.01, 3.55, -D / 2, accentMat);
  const ceiling = new Mesh(own(new PlaneGeometry(W, D).rotateX(Math.PI / 2)), own(new MeshStandardMaterial({ color: '#fbfaf8', roughness: 1 })));
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
  // Arka duvarda mağaza adı
  scene.add(signMesh(data.store.name, opts.accent, Math.min(9, W * 0.6), Math.min(9, W * 0.6) / 6, [0, 2.75, -D + 0.03], 0, own));

  // Gondollar: taban, sırt panosu, raflar, uç panolar, üst başlık — hepsi tek geometri
  const parts: BufferGeometry[] = [];
  for (const g of layout.gondolas) {
    const L = SHELF.length;
    parts.push(new BoxGeometry(0.92, 0.12, L).translate(g.x, 0.06, g.z));
    parts.push(new BoxGeometry(0.05, 1.95, L).translate(g.x, 0.12 + 1.95 / 2, g.z));
    for (const y of SHELF.levels) for (const s of [-1, 1]) parts.push(new BoxGeometry(0.42, 0.035, L).translate(g.x + s * 0.235, y - 0.0175, g.z));
    for (const s of [-1, 1]) parts.push(new BoxGeometry(0.92, 2.0, 0.04).translate(g.x, 1.0, g.z + (s * L) / 2));
  }
  if (parts.length) {
    const shelves = new Mesh(own(mergeGeometries(parts)!), own(new MeshStandardMaterial({ color: '#d9dde2', roughness: 0.45, metalness: 0.35 })));
    scene.add(shelves);
    for (const p of parts) p.dispose();
  }

  // Raf yüzleri: her yüz tek düzlem + tek doku (36 ürün)
  const faces: Face[] = layout.faces.map((f) => {
    const color = PALETTE[f.section % PALETTE.length]!;
    const canvas = document.createElement('canvas');
    canvas.width = LO.w;
    canvas.height = LO.h;
    const tex = makeTex(canvas);
    const mat = new MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: true, alphaTest: 0.02 });
    const geo = new PlaneGeometry(SHELF.cols * SHELF.pitch, SHELF.rows * SHELF.rowHeight).rotateY(f.side > 0 ? Math.PI / 2 : -Math.PI / 2);
    own(geo);
    own(mat);
    const mesh = new Mesh(geo, mat);
    mesh.position.set(...f.center);
    scene.add(mesh);
    // Koridor tabelası: yüzün üstünde, koridora dönük
    scene.add(signMesh(f.label, color, 3.2, 0.5, [f.center[0] + f.side * 0.02, 2.45, f.center[2]], f.side > 0 ? Math.PI / 2 : -Math.PI / 2, own));
    const face: Face = { mesh, products: f.products, color, center: f.center, hi: false, canvas, tex, dirty: false };
    drawFace(face);
    mesh.userData.face = face;
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

  // Öne çıkanlar: dış vitrinle aynı pano (iki yüzlü stand, buildScene)
  const featuredBuilt = data.featured.length
    ? buildScene(
        {
          schema: 'dtd.scene.v1',
          units: 'm',
          background: '#e7e3dc',
          nodes: data.featured.map((p, i) => ({
            id: `one-cikan-${i}`,
            parent: null,
            transform: { p: [layout.featured[i]!.x, 1.5, layout.featured[i]!.z], r: [0, 0, 0, 1], s: [1, 1, 1] },
            components: [
              {
                type: 'board' as const,
                width: 2.4,
                height: 1.8,
                product_id: p.id,
                title: p.name.slice(0, 80),
                price_text: p.price ? formatMinor(p.price.final_minor, p.price.currency) : '',
                color: opts.accent,
                image_url: p.image,
              },
            ],
          })),
        },
        { shadows: false },
      )
    : null;
  if (featuredBuilt) for (const c of [...featuredBuilt.scene.children]) scene.add(c);

  const pickables: Object3D[] = [...faces.map((f) => f.mesh), ...(featuredBuilt ? [...featuredBuilt.nodes.values()] : [])];

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
    update(x, z) {
      for (const f of faces) {
        const d = Math.hypot(f.center[0] - x, f.center[2] - z);
        if (!f.hi && d < NEAR) setDetail(f, true);
        else if (f.hi && d > FAR) setDetail(f, false);
        if (f.dirty) {
          f.tex.needsUpdate = true;
          f.dirty = false;
        }
      }
    },
    dispose() {
      for (const f of faces) f.tex.dispose();
      featuredBuilt?.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

function makeTex(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
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
      loadImage(p.thumb, (img) => {
        if (!f.hi) return;
        drawCell(f, i, img);
        f.dirty = true;
      });
    });
  }
}

function drawFace(f: Face) {
  const ctx = f.canvas.getContext('2d')!;
  ctx.clearRect(0, 0, f.canvas.width, f.canvas.height);
  f.products.forEach((_, i) => {
    const cached = f.hi && f.products[i]!.thumb ? images.get(f.products[i]!.thumb!) : undefined;
    drawCell(f, i, cached && cached !== 'error' && cached.complete && cached.naturalWidth > 0 ? cached : undefined);
  });
  f.dirty = true;
}

/** Bir ürün kartı: beyaz kart, görsel, ad (yakında), renkli fiyat */
function drawCell(f: Face, i: number, img?: HTMLImageElement) {
  const ctx = f.canvas.getContext('2d')!;
  const cw = f.canvas.width / SHELF.cols;
  const ch = f.canvas.height / SHELF.rows;
  const col = i % SHELF.cols;
  const row = Math.floor(i / SHELF.cols);
  const p = f.products[i]!;
  const pad = cw * 0.06;
  const x = col * cw + pad;
  const y = row * ch + pad * 0.6;
  const w = cw - pad * 2;
  const h = ch - pad * 1.2;
  ctx.clearRect(col * cw, row * ch, cw, ch);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  rr(ctx, x + 2, y + 3, w, h, w * 0.06);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  rr(ctx, x, y, w, h, w * 0.06);
  ctx.fill();
  const imgH = h * (f.hi ? 0.56 : 0.66);
  if (img) {
    const k = Math.min((w - 8) / img.naturalWidth, (imgH - 8) / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    ctx.drawImage(img, x + (w - iw) / 2, y + 4 + (imgH - 8 - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = '#eef1f5';
    ctx.fillRect(x + 6, y + 6, w - 12, imgH - 10);
  }
  ctx.textBaseline = 'top';
  if (f.hi) {
    ctx.fillStyle = '#0f172a';
    const fs = Math.round(ch * 0.085);
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    clampLines(ctx, p.name, x + 6, y + imgH + 2, w - 12, Math.round(fs * 1.15), 2);
  }
  const price = p.price ? formatMinor(p.price.final_minor, p.price.currency) : 'Fiyat sitede';
  const ps = Math.round(ch * (f.hi ? 0.1 : 0.13));
  ctx.font = `800 ${ps}px system-ui, sans-serif`;
  ctx.fillStyle = p.in_stock ? f.color : '#94a3b8';
  ctx.fillText(p.in_stock ? price : 'Stokta yok', x + 6, y + h - ps - 6, w - 12);
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

function tileTexture(): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#d9d3c7';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#e4dfd5';
  ctx.fillRect(4, 4, 248, 248);
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.strokeRect(2, 2, 252, 252);
  const t = new CanvasTexture(cv);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clampLines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, max: number) {
  const words = text.split(/\s+/);
  let line = '';
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]!;
    if (ctx.measureText(test).width > maxW && line) {
      if (n === max - 1) {
        let l = line;
        while (ctx.measureText(`${l}…`).width > maxW && l.length > 1) l = l.slice(0, -1);
        ctx.fillText(`${l}…`, x, y + n * lineH);
        return;
      }
      ctx.fillText(line, x, y + n * lineH);
      n++;
      line = words[i]!;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + n * lineH);
}

