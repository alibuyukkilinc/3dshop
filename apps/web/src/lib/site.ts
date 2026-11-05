/**
 * Site ayarları. SITE_INDEXABLE yalnız canlı firmaxi.com'da "true" olur (K55, C3 canlıya geçiş adımı 4);
 * staging ve yerel ortam varsayılan olarak arama motorlarına kapalıdır.
 */
export function isIndexable(env: Record<string, string | undefined> = process.env): boolean {
  return env.SITE_INDEXABLE === 'true';
}

export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return env.SITE_URL ?? 'http://localhost:3101';
}
