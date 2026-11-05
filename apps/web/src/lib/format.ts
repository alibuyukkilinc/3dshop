/**
 * Para gösterimi: kuruş tam sayıdan, kayan nokta aritmetiği olmadan (K33). 1470890 → "14.708,90 TL".
 */
export function formatMinor(minor: number, currency = 'TRY'): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = String(abs % 100).padStart(2, '0');
  const symbol = currency === 'TRY' ? 'TL' : currency;
  return `${negative ? '-' : ''}${whole},${frac} ${symbol}`;
}

/** schema.org Offer.price için nokta ayraçlı ondalık metin: 1470890 → "14708.90". */
export function minorToDecimal(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

export function productPath(p: { id: string; name: string }): string {
  return `/urun/${p.id}/${slug(p.name)}`;
}

const TR: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
export function slug(text: string): string {
  return (
    text
      .toLocaleLowerCase('tr')
      .replace(/[çğıöşü]/g, (c) => TR[c] ?? c)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'urun'
  );
}

export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dakika önce`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} saat önce` : `${Math.round(h / 24)} gün önce`;
}
