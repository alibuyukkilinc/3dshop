import { describe, expect, it } from 'vitest';
import { FACE_CAPACITY, SHELF, layoutInterior, productIndexAt } from './interior-layout';

const items = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('iç mekân yerleşimi (K64)', () => {
  it('her ürün tam bir yüzde; bölüm yüzlere bölünür, yüz kapasitesi aşılmaz', () => {
    const sections = [
      { label: 'İnverterler', products: items(53, 'i') },
      { label: 'Aküler', products: items(7, 'a') },
      { label: 'Diğer', products: items(3, 'd') },
    ];
    const l = layoutInterior(sections, 6);
    const all = l.faces.flatMap((f) => f.products);
    expect(all).toHaveLength(63);
    expect(new Set(all).size).toBe(63);
    expect(l.faces.every((f) => f.products.length <= FACE_CAPACITY)).toBe(true);
    expect(l.faces.map((f) => f.label)).toEqual(['İnverterler', 'İnverterler', 'Aküler', 'Diğer']);
    expect(l.gondolas).toHaveLength(2);
    expect(l.featured).toHaveLength(6);
    // Standlar çakışmaz (pano 2,4 m) ve odanın içinde kalır
    const fx = l.featured.map((f) => f.x).sort((a, b) => a - b);
    for (let i = 1; i < fx.length; i++) expect(fx[i]! - fx[i - 1]!).toBeGreaterThanOrEqual(2.4);
    expect(Math.max(...fx.map(Math.abs))).toBeLessThanOrEqual(l.width / 2 - 1.2);
  });

  it('oda gondolları ve kenar boşluğunu kapsar; çıkış ön duvarda, doğuş içeride', () => {
    const l = layoutInterior([{ label: 'X', products: items(300, 'x') }], 0);
    const xs = l.gondolas.map((g) => g.x);
    expect(Math.min(...xs) - SHELF.faceOffset).toBeGreaterThan(-l.width / 2 + 1);
    expect(Math.max(...xs) + SHELF.faceOffset).toBeLessThan(l.width / 2 - 1);
    expect(l.spawn.z).toBeLessThan(l.exit.minZ);
    expect(l.bounds.max[1]).toBeGreaterThan(l.exit.minZ);
  });

  it('doku koordinatından ürün sırası: üst sol ilk ürün, alt sağ son hücre; boş hücre null', () => {
    expect(productIndexAt(0.01, 0.99, 36)).toBe(0);
    expect(productIndexAt(0.99, 0.01, 36)).toBe(35);
    expect(productIndexAt(0.5 / SHELF.cols + 1 / SHELF.cols, 0.5, 36)).toBe(SHELF.cols + 1);
    expect(productIndexAt(0.99, 0.01, 20)).toBeNull();
  });
});
