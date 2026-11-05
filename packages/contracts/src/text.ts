/**
 * Metin anahtarları. Kaynaktaki adlar (kategori, üretici) eşleme için normalize edilir; kalıcı adresler slug olur.
 */
const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Eşleme anahtarı: kırpılmış, tek boşluklu, Türkçe küçük harf. "  DEYE  " ve "Deye" aynıdır. */
export function normalizeKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr');
}

/** URL parçası: "Güneş Enerjisi & Depolama" → "gunes-enerjisi-depolama". Boş kalırsa hata. */
export function slugify(text: string): string {
  const slug = normalizeKey(text)
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  if (!slug) throw new Error(`Slug üretilemedi: ${text}`);
  return slug;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
