import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Yordamsal dokular (görsel iyileştirme 2): asfalt, kilitli parke, beton plak, çim, yaprak kümesi ve
 * uzak bina cephesi. Hepsi tuvalde, belirlenimci rastgelelikle üretilir (her açılışta aynı görünüm, ağdan
 * indirme yok). Renk dokuları nötr ayrıntı taşır (ortalama ≈ 0,9): asıl rengi malzeme verir, böylece
 * editörde seçilen yüzey rengi korunur. Kabartma dokuları (bumpMap) güneşte yüzeye derinlik verir.
 */

export interface DetailTextures {
  map: CanvasTexture;
  bump: CanvasTexture;
}

function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext('2d', { willReadFrequently: true })!];
}

function toTexture(cv: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const t = new CanvasTexture(cv);
  t.wrapS = t.wrapT = RepeatWrapping;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Her piksele ±spread/2 gri gürültü */
function grain(ctx: CanvasRenderingContext2D, size: number, spread: number, rnd: () => number) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (rnd() - 0.5) * spread;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + d));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + d));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + d));
  }
  ctx.putImageData(img, 0, 0);
}

/** Yumuşak lekeler (döşenmiş: kenardan taşan leke karşı kenarda devam eder) */
function blotches(ctx: CanvasRenderingContext2D, size: number, n: number, rMin: number, rMax: number, colors: string[], rnd: () => number) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = rMin + rnd() * (rMax - rMin);
    const c = colors[Math.floor(rnd() * colors.length)]!;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
  }
}

/** Asfalt: ince agrega, aşınma lekeleri, birkaç ince çatlak. Doku ≈ 6 m. */
export function asphaltTextures(size = 512): DetailTextures {
  const rnd = rng(11);
  const [cv, ctx] = canvas(size);
  ctx.fillStyle = '#e4e4e2';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, 26, 30, 110, ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.10)', 'rgba(40,30,20,0.06)'], rnd);
  // Agrega taneleri
  for (let i = 0; i < size * size * 0.05; i++) {
    const v = rnd();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.15 + v * 0.2})` : `rgba(0,0,0,${0.12 + v * 0.25})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
  }
  grain(ctx, size, 26, rnd);
  // Bump: aynı tuvalin gri kopyası + çatlaklar
  const [bcv, bctx] = canvas(size);
  bctx.drawImage(cv, 0, 0);
  const crack = (c: CanvasRenderingContext2D, color: string, width: number) => {
    const r2 = rng(5);
    c.strokeStyle = color;
    c.lineWidth = width;
    for (let k = 0; k < 2; k++) {
      let x = r2() * size;
      let y = r2() * size;
      c.beginPath();
      c.moveTo(x, y);
      for (let s = 0; s < 14; s++) {
        x += (r2() - 0.5) * 34;
        y += (r2() - 0.3) * 30;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  };
  crack(ctx, 'rgba(20,20,20,0.12)', 1);
  crack(bctx, 'rgba(0,0,0,0.45)', 1.2);
  return { map: toTexture(cv, true), bump: toTexture(bcv, false) };
}

/**
 * Kilitli parke (kaldırım): şaşırtmalı dikdörtgen taşlar, taş başına ton farkı, koyu derzler, pahlı kenar.
 * Doku 3 m × 3 m → 4 sütun × 8 sıra = 75 × 37,5 cm taş.
 */
export function paverTextures(size = 512): DetailTextures {
  const rnd = rng(23);
  const [cv, ctx] = canvas(size);
  const [bcv, bctx] = canvas(size);
  ctx.fillStyle = '#5c5a56';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, size, size);
  const cols = 4;
  const rows = 8;
  const w = size / cols;
  const h = size / rows;
  const j = 3;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? w / 2 : 0;
    for (let c = -1; c < cols; c++) {
      const x = c * w + off;
      const y = r * h;
      const tone = 218 + Math.floor((rnd() - 0.5) * 30);
      const warm = Math.floor(rnd() * 8);
      ctx.fillStyle = `rgb(${tone + warm},${tone + warm / 2},${tone - 2})`;
      ctx.fillRect(x + j / 2, y + j / 2, w - j, h - j);
      // Pah: kenarlara doğru koyulaşan bump
      for (let b = 0; b < 4; b++) {
        const v = 140 + b * 30;
        bctx.fillStyle = `rgb(${v},${v},${v})`;
        bctx.fillRect(x + j / 2 + b, y + j / 2 + b, w - j - b * 2, h - j - b * 2);
      }
    }
  }
  blotches(ctx, size, 18, 20, 70, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.08)', 'rgba(60,50,30,0.05)'], rnd);
  grain(ctx, size, 22, rnd);
  grain(bctx, size, 30, rnd);
  return { map: toTexture(cv, true), bump: toTexture(bcv, false) };
}

/** Beton plak (meydan, bina arası): 2 × 2 m levhalar, ince derz, hafif leke. Doku 4 m. */
export function slabTextures(size = 512): DetailTextures {
  const rnd = rng(37);
  const [cv, ctx] = canvas(size);
  const [bcv, bctx] = canvas(size);
  ctx.fillStyle = '#e6e3de';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#c8c8c8';
  bctx.fillRect(0, 0, size, size);
  const n = 2;
  const s = size / n;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const tone = 228 + Math.floor((rnd() - 0.5) * 18);
      ctx.fillStyle = `rgb(${tone},${tone - 2},${tone - 5})`;
      ctx.fillRect(c * s + 2, r * s + 2, s - 4, s - 4);
    }
  blotches(ctx, size, 30, 15, 90, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.10)', 'rgba(70,60,40,0.05)'], rnd);
  grain(ctx, size, 18, rnd);
  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  bctx.strokeStyle = '#000';
  for (const c of [ctx, bctx]) {
    c.lineWidth = 3;
    for (let k = 0; k <= size; k += s) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k, size);
      c.moveTo(0, k);
      c.lineTo(size, k);
      c.stroke();
    }
  }
  grain(bctx, size, 40, rnd);
  return { map: toTexture(cv, true), bump: toTexture(bcv, false) };
}

/** Çim: ince yaprak dokusu ve tonu değişen alanlar. Doku 8 m. */
export function grassTextures(size = 512): DetailTextures {
  const rnd = rng(41);
  const [cv, ctx] = canvas(size);
  ctx.fillStyle = '#6f8f4e';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, 40, 30, 120, ['rgba(140,150,60,0.18)', 'rgba(40,70,30,0.2)', 'rgba(120,110,60,0.12)'], rnd);
  for (let i = 0; i < size * size * 0.12; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const g = 90 + rnd() * 90;
    ctx.strokeStyle = `rgba(${g * 0.6},${g},${g * 0.35},0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 4);
    ctx.stroke();
  }
  grain(ctx, size, 20, rnd);
  const [bcv, bctx] = canvas(size);
  bctx.drawImage(cv, 0, 0);
  return { map: toTexture(cv, true), bump: toTexture(bcv, false) };
}

/** Yaprak kümesi (saydam): ağaç taç kartlarında; alfa testiyle kesilir */
export function leafTexture(size = 256): CanvasTexture {
  const rnd = rng(53);
  const [cv, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  for (let i = 0; i < 420; i++) {
    // Merkezde yoğun, kenarda seyrek: kartın kare kenarı görünmesin
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.75) * size * 0.46;
    const x = cx + Math.cos(a) * r;
    const y = cx + Math.sin(a) * r;
    const l = 6 + rnd() * 8;
    const g = 0.55 + rnd() * 0.45;
    ctx.fillStyle = `rgb(${Math.floor(62 * g + 18 + rnd() * 18)},${Math.floor(100 * g + 28)},${Math.floor(38 * g + 12)})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Uzak bina cephesi: kat bantları ve pencere ızgarası (camların bir kısmı aydınlık). Bir doku = 4 kat ×
 * 6 pencere (≈ 12 m × 12 m); uzak siluet kutularında yinelenir.
 */
export function facadeTexture(seed: number, base: string, size = 256): CanvasTexture {
  const rnd = rng(seed);
  const [cv, ctx] = canvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const floors = 4;
  const cols = 6;
  const fh = size / floors;
  const cw = size / cols;
  for (let f = 0; f < floors; f++)
    for (let c = 0; c < cols; c++) {
      const v = rnd();
      const lit = v > 0.86;
      const sky = 60 + Math.floor(rnd() * 40);
      ctx.fillStyle = lit ? `rgb(${200 + sky / 4},${190 + sky / 4},${150})` : `rgb(${sky * 0.55},${sky * 0.7},${sky * 0.9})`;
      ctx.fillRect(c * cw + cw * 0.14, f * fh + fh * 0.2, cw * 0.72, fh * 0.6);
    }
  grain(ctx, size, 14, rnd);
  return toTexture(cv, true);
}
