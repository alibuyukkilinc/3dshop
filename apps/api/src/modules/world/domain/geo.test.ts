import { describe, expect, it } from 'vitest';
import { cellOf, haversineKm, insideTurkeyBox } from './geo.js';

describe('konum yardımcıları', () => {
  it('haversine: Ankara–İstanbul ~350 km', () => {
    expect(Math.round(haversineKm(39.9334, 32.8597, 41.0082, 28.9784))).toBe(349); // kuş uçuşu
    expect(haversineKm(40, 30, 40, 30)).toBe(0);
  });
  it('hücre: negatif koordinatlar aşağı yuvarlanır', () => {
    expect(cellOf(100, 20, 64)).toEqual({ cellX: 1, cellZ: 0 });
    expect(cellOf(-1, -64, 64)).toEqual({ cellX: -1, cellZ: -1 });
  });
  it('Türkiye kutusu', () => {
    expect(insideTurkeyBox(41.0167, 34.0333)).toBe(true);
    expect(insideTurkeyBox(48.85, 2.35)).toBe(false);
  });
});
