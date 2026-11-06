import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  TorusGeometry,
} from 'three';
import { formatMinor } from '../format';

/**
 * Mağaza içi efektler (mağaza deneyimi): öne çıkan ürünler için dönen vitrin podyumları (ışık konisi, parıltı,
 * ışıklı halka) ve raf hücresi vurgusu (üzerine gelme, seçili ürün). Yalnız istemci süsüdür; sahne belgesine
 * yazılmaz (K45). Ürün görseli kaynak CDN'den (K41).
 */

export interface ShowcaseProduct {
  id: string;
  name: string;
  price: { final_minor: number; list_minor: number; currency: string } | null;
  image: string;
}

export interface Showcases {
  root: Group;
  /** Seçilebilir nesneler (userData.productId) */
  pickables: Group[];
  tick(t: number): void;
  dispose(): void;
}

type Load = (url: string, onReady: (img: HTMLImageElement) => void) => void;

/** Vitrin podyumu: parlak kaide, ışıklı halka, üstünde yavaşça dönen ve süzülen çift yüzlü ürün kartı */
export function buildShowcases(products: ShowcaseProduct[], spots: { x: number; z: number }[], accent: string, load: Load): Showcases {
  const root = new Group();
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const accentColor = new Color(accent);

  // Ortak geometri ve malzemeler (podyum başına çizim çağrısı az kalsın)
  const baseGeo = own(new CylinderGeometry(0.58, 0.66, 0.9, 48));
  const ringGeo = own(new TorusGeometry(0.6, 0.022, 8, 72).rotateX(Math.PI / 2));
  const topGeo = own(new CircleGeometry(0.57, 48).rotateX(-Math.PI / 2));
  const coneGeo = own(new ConeGeometry(0.78, 2.5, 40, 1, true));
  const cardGeo = own(new PlaneGeometry(0.98, 0.98));
  const plateGeo = own(new PlaneGeometry(1.12, 0.34));
  const baseMat = own(new MeshStandardMaterial({ color: '#f7f7f5', roughness: 0.18, metalness: 0.08 }));
  const ringMat = own(new MeshBasicMaterial({ color: accentColor.clone().multiplyScalar(1.6) }));
  const topMat = own(new MeshStandardMaterial({ color: '#ffffff', emissive: accentColor, emissiveIntensity: 0.35, roughness: 0.3 }));
  const coneMat = own(
    new MeshBasicMaterial({
      color: new Color('#fff6e0').lerp(accentColor, 0.15),
      alphaMap: own(gradientTexture()),
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const sparkTex = own(sparkTexture());

  const items: { card: Group; sparks: Points; phase: number }[] = [];
  const pickables: Group[] = [];

  products.forEach((p, i) => {
    const spot = spots[i];
    if (!spot) return;
    const g = new Group();
    g.position.set(spot.x, 0, spot.z);
    g.userData.productId = p.id;

    const base = new Mesh(baseGeo, baseMat);
    base.position.y = 0.45;
    const ring = new Mesh(ringGeo, ringMat);
    ring.position.y = 0.91;
    const top = new Mesh(topGeo, topMat);
    top.position.y = 0.902;
    const cone = new Mesh(coneGeo, coneMat);
    cone.position.y = 0.9 + 1.25;
    cone.userData.noAO = true;
    cone.raycast = () => {};

    // Ürün kartı: önde ve arkada ayrı düzlem (iki yüzde de görsel düz okunur)
    const card = new Group();
    card.position.y = 1.62;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    drawCard(cv, null, accent);
    const tex = own(canvasTex(cv));
    // Ürün görseli kaynak renginde (ışık ve film tonlaması soldurmaz)
    const cardMat = own(new MeshBasicMaterial({ map: tex, color: '#f2f2f2', toneMapped: false, transparent: true, alphaTest: 0.05 }));
    const front = new Mesh(cardGeo, cardMat);
    const back = new Mesh(cardGeo, cardMat);
    back.rotation.y = Math.PI;
    card.add(front, back);
    load(p.image, (img) => {
      drawCard(cv, img, accent);
      tex.needsUpdate = true;
    });

    // Ad ve fiyat plakası: kaidenin girişe bakan yüzünde
    const pc = document.createElement('canvas');
    pc.width = 768;
    pc.height = 232;
    drawPlate(pc, p, accent);
    const plateTex = own(canvasTex(pc));
    const plate = new Mesh(plateGeo, own(new MeshStandardMaterial({ map: plateTex, emissive: '#ffffff', emissiveMap: plateTex, emissiveIntensity: 0.22, transparent: true })));
    plate.position.set(0, 0.5, 0.672);
    plate.rotation.x = -0.12;

    // Parıltılar: kartın çevresinde dönen küçük ışık noktaları
    const pts: number[] = [];
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2 + Math.random() * 0.4;
      const r = 0.55 + Math.random() * 0.35;
      pts.push(Math.cos(a) * r, 1.0 + Math.random() * 1.3, Math.sin(a) * r);
    }
    const sg = own(new BufferGeometry());
    sg.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const sparks = new Points(
      sg,
      own(new PointsMaterial({ map: sparkTex, color: new Color('#fff3d0').lerp(accentColor, 0.25), size: 0.07, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.9 })),
    );
    sparks.userData.noAO = true;
    sparks.raycast = () => {};

    g.add(base, ring, top, cone, card, plate, sparks);
    root.add(g);
    pickables.push(g);
    items.push({ card, sparks, phase: i * 1.7 });
  });

  return {
    root,
    pickables,
    tick(t) {
      for (const it of items) {
        it.card.rotation.y = t * 0.55 + it.phase;
        it.card.position.y = 1.62 + Math.sin(t * 1.3 + it.phase) * 0.045;
        it.sparks.rotation.y = -t * 0.35 + it.phase;
        (it.sparks.material as PointsMaterial).opacity = 0.65 + Math.sin(t * 2.1 + it.phase) * 0.25;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Raf hücresi vurgusu: ışıklı yuvarlak çerçeve; seçili olan nabız gibi atar */
export function createCellFrame(accent: string, w: number, h: number): { mesh: Mesh; dispose(): void } {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = Math.round((256 * h) / w);
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 14;
  roundRect(ctx, 12, 12, cv.width - 24, cv.height - 24, 22);
  ctx.stroke();
  const tex = canvasTex(cv);
  const geo = new PlaneGeometry(w, h);
  const mat = new MeshBasicMaterial({ map: tex, color: new Color(accent).lerp(new Color('#ffffff'), 0.35).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: AdditiveBlending });
  const mesh = new Mesh(geo, mat);
  mesh.visible = false;
  mesh.userData.noAO = true;
  mesh.raycast = () => {};
  return {
    mesh,
    dispose() {
      tex.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

function canvasTex(cv: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Kart: beyaz yuvarlak köşeli zemin, ürün görseli ortada, ince vurgu kenarı */
function drawCard(cv: HTMLCanvasElement, img: HTMLImageElement | null, accent: string) {
  const ctx = cv.getContext('2d')!;
  const s = cv.width;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 6, 6, s - 12, s - 12, 56);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  roundRect(ctx, 10, 10, s - 20, s - 20, 52);
  ctx.stroke();
  if (img && img.naturalWidth > 0) {
    const pad = 44;
    const k = Math.min((s - pad * 2) / img.naturalWidth, (s - pad * 2) / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
  } else {
    ctx.fillStyle = '#eef1f5';
    roundRect(ctx, 60, 60, s - 120, s - 120, 30);
    ctx.fill();
  }
}

function drawPlate(cv: HTMLCanvasElement, p: ShowcaseProduct, accent: string) {
  const ctx = cv.getContext('2d')!;
  const { width: w, height: h } = cv;
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  roundRect(ctx, 4, 4, w - 8, h - 8, 28);
  ctx.fill();
  ctx.fillStyle = accent;
  roundRect(ctx, 4, 4, 14, h - 8, 7);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  let name = p.name;
  while (ctx.measureText(name).width > w - 70 && name.length > 4) name = name.slice(0, -2);
  if (name !== p.name) name = `${name.trimEnd()}…`;
  ctx.fillText(name, 40, 30);
  ctx.font = '800 64px system-ui, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(p.price ? formatMinor(p.price.final_minor, p.price.currency) : 'Fiyat sitede', 40, 100);
  if (p.price && p.price.list_minor > p.price.final_minor) {
    const x = 40 + ctx.measureText(formatMinor(p.price.final_minor, p.price.currency)).width + 24;
    ctx.font = '500 36px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    const t = formatMinor(p.price.list_minor, p.price.currency);
    ctx.fillText(t, x, 122);
    ctx.fillRect(x, 140, ctx.measureText(t).width, 3);
  }
}

/** Işık konisinin saydamlık geçişi: tepede yoğun, tabanda sönük; kenarlar yumuşak */
function gradientTexture(): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#555555');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new CanvasTexture(cv);
}

function sparkTexture(): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
