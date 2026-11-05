import { describe, expect, it } from 'vitest';
import { SLUG_RE, normalizeKey, slugify } from './text.js';

describe('metin anahtarları', () => {
  it('normalizeKey Türkçe küçük harf ve boşluk', () => {
    expect(normalizeKey('  İNVERTER   Grubu ')).toBe('inverter grubu');
    expect(normalizeKey('DEYE')).toBe(normalizeKey('Deye'));
  });
  it('slugify Türkçe karakterleri çevirir', () => {
    expect(slugify('Güneş Enerjisi & Depolama')).toBe('gunes-enerjisi-depolama');
    expect(slugify('Işık Çözümleri')).toBe('isik-cozumleri');
    expect(SLUG_RE.test(slugify('6. Sınıf Denemeleri'))).toBe(true);
    expect(() => slugify('!!!')).toThrow();
  });
});
