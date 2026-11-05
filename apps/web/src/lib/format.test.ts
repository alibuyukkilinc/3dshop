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
