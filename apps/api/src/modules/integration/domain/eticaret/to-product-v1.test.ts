import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { productContentHash } from '../content-hash.js';
import { EticaretExportPageSchema, EticaretProductSchema } from './export-schema.js';
import { toProductV1 } from './to-product-v1.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../test/fixtures/eticaret', name), 'utf8'));

const items = [...fixture('export-page-1.json').data.items, ...fixture('export-page-2.json').data.items];
const map = (id: number) => toProductV1(EticaretProductSchema.parse(items.find((i) => i.product_id === id)), 'esensolarmarket');

describe('eticaret export → commerce.product.v1 (sözleşme testi)', () => {
  it('sayfa zarfını tanır', () => {
    expect(EticaretExportPageSchema.parse(fixture('export-page-1.json')).data.has_more).toBe(true);
  });

  it('buy_price ve tedarikçi hiçbir yere taşınmaz (K41)', () => {
    for (const raw of items) {
      const parsed = EticaretProductSchema.parse(raw);
      expect(JSON.stringify(parsed)).not.toMatch(/buy_price|777\.77|Gizli Tedarikçi/);
      expect(JSON.stringify(toProductV1(parsed, 'x'))).not.toMatch(/buy_price|777|Tedarikçi|supplier/i);
    }
  });

  it('son fiyatı kuruşa çevirir; indirim bitişini taşır; ham sell_price kullanılmaz', () => {
    const p = map(101);
    expect(p.price).toEqual({
      final_minor: 1470890,
      list_minor: 1599900,
      currency: 'TRY',
      tax_included: true,
      valid_until: '2026-11-30T23:59:59+03:00',
    });
  });

  it('kategori adlarını tekilleştirir, görsellerden tekrarı ve göreli adresi atar', () => {
    const p = map(101);
    expect(p.categories).toEqual([
      { external_id: 'hibrit inverter', name: 'Hibrit İnverter' },
      { external_id: 'inverterler', name: 'İnverterler' },
    ]);
    expect(p.media).toEqual([{ kind: 'image', url: 'https://esensolarmarket.com/img/101-a.jpg' }]);
    expect(p.brand).toEqual({ source_name: 'Deye' });
    expect(p.url).toBe('https://esensolarmarket.com/tr/urun-101');
  });

  it('supplier_status=0 ürünü inactive yapar; "id0" marka değildir; boş langs [] gelir', () => {
    const p = map(102);
    expect(p.status).toBe('inactive');
    expect(p.brand).toBeNull();
    expect(p.i18n).toEqual({});
    expect(p.physical).toBeNull();
  });

  it('seçenekleri varyanta çevirir: kararlı ref, seçenek fiyatı ve stoğu', () => {
    expect(map(103).variants).toEqual([
      { external_ref: '7:48', options: [{ group: 'Ders', value: 'Matematik' }], sku: null, price: { final_minor: 12050 }, stock: { quantity: 10 } },
      { external_ref: '7:49', options: [{ group: 'Ders', value: 'Fizik' }], sku: null, price: { final_minor: 9999 }, stock: { quantity: 0 } },
    ]);
  });

  it('hideprice: fiyat null → fiyatsız ürün, URL yoksa null', () => {
    const p = map(104);
    expect(p.price).toBeNull();
    expect(p.url).toBeNull();
  });

  it('kaynağın kararsız sıraları (galeri, kategori, seçenek) ürünü "değişmiş" göstermez', () => {
    const raw = EticaretProductSchema.parse({
      ...items.find((i) => i.product_id === 103),
      images: ['https://x.test/main.jpg', 'https://x.test/b.jpg', 'https://x.test/a.jpg'],
      categories: ['Ders', 'Ana'],
    });
    const shuffled = {
      ...raw,
      images: ['https://x.test/main.jpg', 'https://x.test/a.jpg', 'https://x.test/b.jpg'],
      categories: ['Ana', 'Ders'],
      options: [...raw.options].reverse(),
    };
    const a = toProductV1(raw, 's');
    const b = toProductV1(shuffled, 's');
    expect(a.media.map((m) => m.url)).toEqual(['https://x.test/main.jpg', 'https://x.test/a.jpg', 'https://x.test/b.jpg']);
    expect(a.categories).toEqual(b.categories);
    expect(productContentHash(a)).toBe(productContentHash(b));
  });

  it('içerik özeti kaynak zamanından bağımsız, içerikle değişir', () => {
    const a = map(101);
    expect(productContentHash({ ...a, source: { ...a.source, updated_at: '2030-01-01 00:00:00' } })).toBe(productContentHash(a));
    expect(productContentHash({ ...a, stock: { quantity: 99 } })).not.toBe(productContentHash(a));
  });
});
