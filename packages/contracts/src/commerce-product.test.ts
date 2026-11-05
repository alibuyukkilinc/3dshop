import { describe, expect, it } from 'vitest';
import { toMinor } from './commerce-product.js';

describe('toMinor (K33: float aritmetiği yok)', () => {
  it('ondalık değerleri kuruşa çevirir', () => {
    expect(toMinor(14708.9)).toBe(1470890);
    expect(toMinor('1249.90')).toBe(124990);
    expect(toMinor(0)).toBe(0);
    expect(toMinor(264802.9)).toBe(26480290);
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });
  it('üçüncü haneyi yarım yukarı yuvarlar', () => {
    expect(toMinor('10.005')).toBe(1001);
    expect(toMinor('10.004')).toBe(1000);
  });
  it('negatif ve tanınmayan değerleri reddeder', () => {
    expect(() => toMinor(-1)).toThrow();
    expect(() => toMinor('1,5')).toThrow();
    expect(() => toMinor(Number.NaN)).toThrow();
  });
});
