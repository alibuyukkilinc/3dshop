/**
 * Ürün panosu dokusu (K56): her motor aynı tuvale çizer, sonra kendi doku nesnesine çevirir.
 * Tarayıcıda çalışır (CanvasRenderingContext2D).
 */
export const BOARD_TEXTURE_PX = { w: 512, h: 384 } as const;

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  board: { title: string; price_text: string; color: string },
): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = board.color;
  ctx.fillRect(0, 0, w, Math.round(h * 0.16));
  // Ürün görseli yerine yer tutucu (F1'de gerçek ürün görseli kaynak siteden gelir)
  ctx.fillStyle = '#eef1f5';
  ctx.fillRect(w * 0.08, h * 0.22, w * 0.84, h * 0.4);
  ctx.strokeStyle = board.color;
  ctx.lineWidth = 6;
  ctx.strokeRect(w * 0.08, h * 0.22, w * 0.84, h * 0.4);
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${Math.round(h * 0.085)}px system-ui, sans-serif`;
  wrap(ctx, board.title, w * 0.08, h * 0.66, w * 0.84, Math.round(h * 0.1), 2);
  if (board.price_text) {
    ctx.fillStyle = board.color;
    ctx.font = `bold ${Math.round(h * 0.1)}px system-ui, sans-serif`;
    ctx.fillText(board.price_text, w * 0.08, h * 0.86);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lineH);
      line = word;
      if (++lines >= maxLines) return;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + lines * lineH);
}
