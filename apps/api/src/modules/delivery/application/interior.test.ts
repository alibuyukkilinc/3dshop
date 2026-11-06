import { describe, expect, it } from 'vitest';
import { INTERIOR_MAX_SECTIONS, OTHER_SECTION, thumbOf, toSections } from './interior.service.js';

const p = (id: string) => ({ id });

describe('iç mekân koridorları (K64)', () => {
  it('büyükten küçüğe; küçük gruplar ve etiketsizler en sonda "Diğer"de; grup içi sıra korunur', () => {
    const items = ['a1', 'b1', 'a2', 'c1', 'a3', 'b2', 'a4', 'b3', 'b4', 'b5', 'x1'].map(p);
    const labels = new Map<string, string>([
      ...['a1', 'a2', 'a3', 'a4'].map((i) => [i, 'Aküler'] as [string, string]),
      ...['b1', 'b2', 'b3', 'b4', 'b5'].map((i) => [i, 'İnverterler'] as [string, string]),
      ['c1', 'Kablo'],
    ]);
    const s = toSections(items, labels);
    expect(s.map((x) => x.label)).toEqual(['İnverterler', 'Aküler', OTHER_SECTION]);
    expect(s[1]!.products.map((x) => x.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(s[2]!.products.map((x) => x.id)).toEqual(['c1', 'x1']);
    expect(s.flatMap((x) => x.products)).toHaveLength(items.length);
  });

  it('koridor tavanı aşılırsa fazlası "Diğer"e', () => {
    const items = Array.from({ length: 15 * 5 }, (_, i) => p(`p${i}`));
    const labels = new Map(items.map((x, i) => [x.id, `K${Math.floor(i / 5)}`]));
    const s = toSections(items, labels);
    expect(s).toHaveLength(INTERIOR_MAX_SECTIONS);
    expect(s.at(-1)!.label).toBe(OTHER_SECTION);
    expect(s.flatMap((x) => x.products)).toHaveLength(items.length);
  });

  it('küçük görsel: _high/_medium → _low; ekli olmayan adres değişmez', () => {
    expect(thumbOf('https://cdn.x/a-p1_high.webp')).toBe('https://cdn.x/a-p1_low.webp');
    expect(thumbOf('https://cdn.x/a_medium.jpg')).toBe('https://cdn.x/a_low.jpg');
    expect(thumbOf('https://cdn.x/a.png')).toBe('https://cdn.x/a.png');
    expect(thumbOf(null)).toBeNull();
  });
});
