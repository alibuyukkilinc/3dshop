/**
 * Delta filigranı (K42). eticaret date_updated'i saniye hassasiyetli, saat dilimsiz "YYYY-MM-DD HH:MM:SS" metnidir
 * ve export "updated_since"tan KESİN büyükleri döner. Aynı saniyede, bizim okumamızdan sonra güncellenen ürün
 * kaçmasın diye istek filigranın OVERLAP_SECONDS gerisinden yapılır; tekrar gelen ürünleri content_hash eler.
 * Saat dilimine dönüştürme yapılmaz: değer kaynağın kendi saatinde kalır, yalnız alan alana çıkarılır.
 */
export const OVERLAP_SECONDS = 120;

const SOURCE_TS = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export function isSourceTimestamp(value: string): boolean {
  return SOURCE_TS.test(value);
}

/** Filigranı ilerletir: aynı biçimde sabit genişlikli metin olduğundan sözlük sırası zaman sırasıdır. */
export function maxWatermark(current: string | null, candidate: string): string | null {
  if (!isSourceTimestamp(candidate)) return current;
  return current === null || candidate > current ? candidate : current;
}

/** Kaynağa gönderilecek updated_since: filigran − OVERLAP_SECONDS, aynı biçimde. */
export function requestSince(watermark: string, overlapSeconds = OVERLAP_SECONDS): string {
  const m = SOURCE_TS.exec(watermark);
  if (!m) throw new Error(`Filigran biçimi tanınmadı: ${watermark}`);
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  // Date yalnız takvim aritmetiği için UTC alanlarıyla kullanılır; saat dilimi anlamı taşımaz
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - overlapSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}
