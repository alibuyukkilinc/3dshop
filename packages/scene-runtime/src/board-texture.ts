/**
 * Ürün panosu dokusu (K56): her motor aynı tuvale çizer, sonra kendi doku nesnesine çevirir.
 * Tarayıcıda çalışır (CanvasRenderingContext2D). Oran pano boyutuyla aynı (4:3, 2,4 × 1,8 m).
 *
 * İki yerleşim: ürün kartı (görsel + başlık + fiyat rozeti) ve tabela (fiyat ve görsel yoksa: tam renkli
 * zemin, ortada büyük başlık — durak ve mağaza adları).
 */
export const BOARD_TEXTURE_PX = { w: 768, h: 576 } as const;

type Img = CanvasImageSource & { width: number; height: number };
interface BoardContent {
  title: string;
  price_text: string;
  color: string;
  image_url?: string;
}

export function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, board: BoardContent, image?: Img): void {
  if (!board.price_text && !board.image_url) return drawSign(ctx, w, h, board);
  const pad = Math.round(w * 0.045);

  // Kart zemini: hafif dikey geçiş (düz beyaz 3D'de "kâğıt" gibi durur)
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, '#eef2f6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Üst renk şeridi
  ctx.fillStyle = board.color;
  ctx.fillRect(0, 0, w, Math.round(h * 0.035));

  // Ürün görseli alanı (oran korunur, ortalanır); yüklenene kadar yumuşak yer tutucu
  const box = { x: pad, y: Math.round(h * 0.07), w: w - pad * 2, h: Math.round(h * 0.55) };
  roundRect(ctx, box.x, box.y, box.w, box.h, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 3;
  ctx.stroke();
  if (image && image.width > 0 && image.height > 0) {
    const inner = { x: box.x + 12, y: box.y + 12, w: box.w - 24, h: box.h - 24 };
    const k = Math.min(inner.w / image.width, inner.h / image.height);
    const iw = image.width * k;
    const ih = image.height * k;
    ctx.drawImage(image, inner.x + (inner.w - iw) / 2, inner.y + (inner.h - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `600 ${Math.round(h * 0.045)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Görsel yükleniyor', box.x + box.w / 2, box.y + box.h / 2);
    ctx.textAlign = 'left';
  }

  // Başlık: en çok iki satır, sığmazsa üç noktayla
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'top';
  const titleSize = Math.round(h * 0.062);
  ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
  wrap(ctx, board.title, pad, Math.round(h * 0.655), w - pad * 2, Math.round(titleSize * 1.18), 2);

  // Fiyat rozeti (renkli zemin, beyaz yazı) + "dokun" ipucu
  if (board.price_text) {
    const size = Math.round(h * 0.075);
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    const tw = ctx.measureText(board.price_text).width;
    const bh = Math.round(size * 1.45);
    const by = h - pad - bh;
    roundRect(ctx, pad, by, tw + size * 0.9, bh, bh / 2);
    ctx.fillStyle = board.color;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(board.price_text, pad + size * 0.45, by + bh / 2 + 1);
    ctx.fillStyle = '#64748b';
    ctx.font = `600 ${Math.round(h * 0.04)}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('Dokun → incele', w - pad, by + bh / 2);
    ctx.textAlign = 'left';
  }
}

function drawSign(ctx: CanvasRenderingContext2D, w: number, h: number, board: BoardContent) {
  ctx.fillStyle = board.color;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Yazı tuvale sığana kadar küçülür
  let size = Math.round(h * 0.42);
  do {
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    size -= 4;
  } while (ctx.measureText(board.title).width > w * 0.9 && size > 12);
  ctx.fillText(board.title, w / 2, h / 2);
  ctx.textAlign = 'left';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]!;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = words[i]!;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (i < words.length) {
    // Kalan kelimeler sığmadı: son satır üç noktayla kısaltılır
    let last = lines[maxLines - 1]!;
    while (ctx.measureText(`${last}…`).width > maxW && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '));
    lines[maxLines - 1] = `${last}…`;
  }
  lines.slice(0, maxLines).forEach((l, k) => ctx.fillText(l, x, y + k * lineH));
}
