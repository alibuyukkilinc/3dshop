import { drawBoard } from '@dtd/scene-runtime';

/**
 * Mağaza tabelası (logo): kaynak sitenin logosu beyaz tabelada, altta mağaza renginde şerit. Logo yoksa ya da
 * yüklenemezse mağaza adı yazılı renkli pano (önceki görünüm). Dış cephe ve iç mekân arka duvarı ortak.
 */

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** Kaynak CDN görseli (CORS açık; tuvale çizilebilsin diye anonymous) */
export function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

export function drawStoreSign(ctx: CanvasRenderingContext2D, w: number, h: number, o: { name: string; color: string; logo: HTMLImageElement | null }) {
  if (!o.logo) {
    drawBoard(ctx, w, h, { title: o.name, price_text: '', color: o.color });
    return;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const stripe = Math.round(h * 0.09);
  ctx.fillStyle = o.color;
  ctx.fillRect(0, h - stripe, w, stripe);
  const padX = w * 0.06;
  const padY = h * 0.12;
  const bw = w - padX * 2;
  const bh = h - stripe - padY * 2;
  const k = Math.min(bw / o.logo.naturalWidth, bh / o.logo.naturalHeight);
  const lw = o.logo.naturalWidth * k;
  const lh = o.logo.naturalHeight * k;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(o.logo, (w - lw) / 2, padY + (bh - lh) / 2, lw, lh);
}
