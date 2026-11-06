import { describe, expect, it } from 'vitest';
import { formatMinor, minorToDecimal, productPath, slug } from './format';

describe('vitrin biçimleri', () => {
  it('kuruştan TL metni (float yok)', () => {
    expect(formatMinor(1470890)).toBe('14.708,90 TL');
    expect(formatMinor(5)).toBe('0,05 TL');
    expect(formatMinor(100000000)).toBe('1.000.000,00 TL');
    expect(formatMinor(1999, 'USD')).toBe('19,99 USD');
    expect(minorToDecimal(1470890)).toBe('14708.90');
  });
  it('ürün adresi Türkçe karakterleri çevirir', () => {
    expect(slug('4.2kw Mppt Offgrid Güneş İnverteri')).toBe('4-2kw-mppt-offgrid-gunes-inverteri');
    expect(productPath({ id: 'abc', name: 'Şarj Cihazı' })).toBe('/urun/abc/sarj-cihazi');
    expect(slug('!!!')).toBe('urun');
  });
});

describe('duyarlı görseller (K4)', async () => {
  const { responsiveImage } = await import('./images');
  it('_high kalıbında küçük varyant ve srcset; kalıp dışı aynen', () => {
    const u = 'https://cdn.shopyplus.com/x.com/products/2026-05/a-p1_high.webp';
    expect(responsiveImage(u, 'card')).toEqual({
      src: 'https://cdn.shopyplus.com/x.com/products/2026-05/a-p1_medium.webp',
      srcSet: 'https://cdn.shopyplus.com/x.com/products/2026-05/a-p1_medium.webp 340w, https://cdn.shopyplus.com/x.com/products/2026-05/a-p1_high.webp 800w',
    });
    expect(responsiveImage(u, 'detail').src).toBe(u);
    expect(responsiveImage(u, 'thumb')).toEqual({ src: 'https://cdn.shopyplus.com/x.com/products/2026-05/a-p1_medium.webp' });
    expect(responsiveImage('https://cdn.shopyplus.com/solarbank.com.tr/2026-09/hp5.png', 'card')).toEqual({ src: 'https://cdn.shopyplus.com/solarbank.com.tr/2026-09/hp5.png' });
  });
});
