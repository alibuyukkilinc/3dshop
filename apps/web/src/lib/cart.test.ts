import { describe, expect, it } from 'vitest';
import { type CartItem, MAX_QTY, addItem, applyLive, countOf, groupByStore, parseCart, setItemQty, subtotal } from './cart';

const P1 = '0190a1b2-0000-7000-8000-000000000001';
const P2 = '0190a1b2-0000-7000-8000-000000000002';
const P3 = '0190a1b2-0000-7000-8000-000000000003';
const base = (id: string, store = 'solarbank', final = 10000): Omit<CartItem, 'qty' | 'added_at'> => ({
  product_id: id,
  store_slug: store,
  store_name: store,
  name: `Ürün ${id.slice(-1)}`,
  image: null,
  price: { final_minor: final, list_minor: final, currency: 'TRY' },
  in_stock: true,
});

describe('platform sepeti (K14 pilot)', () => {
  it('ekleme: aynı ürün adedi artar, yeni ürün başa gelir, adet tavanı', () => {
    let s = addItem([], base(P1), 1, 1);
    s = addItem(s, base(P2), 2, 2);
    s = addItem(s, base(P1), 3, 3);
    expect(s.map((i) => [i.product_id, i.qty])).toEqual([
      [P2, 2],
      [P1, 4],
    ]);
    expect(addItem(s, base(P1), 99, 4).find((i) => i.product_id === P1)!.qty).toBe(MAX_QTY);
    expect(countOf(s)).toBe(6);
  });

  it('adet 0 ürünü çıkarır', () => {
    const s = addItem(addItem([], base(P1), 1, 1), base(P2), 1, 2);
    expect(setItemQty(s, P1, 0).map((i) => i.product_id)).toEqual([P2]);
    expect(setItemQty(s, P2, 5).find((i) => i.product_id === P2)!.qty).toBe(5);
  });

  it('ara toplam kuruş tam sayı; fiyatsız ürün varsa eksik işaretli', () => {
    let s = addItem([], base(P1, 'a', 1990), 3, 1);
    s = addItem(s, base(P2, 'a', 1005), 1, 2);
    expect(subtotal(s)).toEqual({ minor: 6975, currency: 'TRY', partial: false });
    s = addItem(s, { ...base(P3), price: null }, 1, 3);
    expect(subtotal(s)).toEqual({ minor: 6975, currency: 'TRY', partial: true });
  });

  it('mağazaya göre gruplar (her mağazanın ödemesi kendi sitesinde)', () => {
    let s = addItem([], base(P1, 'a'), 1, 1);
    s = addItem(s, base(P2, 'b'), 1, 2);
    s = addItem(s, base(P3, 'a'), 1, 3);
    expect(groupByStore(s).map((g) => [g.store_slug, g.items.length])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('canlı fiyat/stok yenilemesi; değişiklik yoksa aynı dizi', () => {
    const s = addItem([], base(P1, 'a', 1000), 1, 1);
    expect(applyLive(s, new Map([[P1, { price: { final_minor: 1000, list_minor: 1000, currency: 'TRY' }, in_stock: true }]]))).toBe(s);
    const n = applyLive(s, new Map([[P1, { price: { final_minor: 900, list_minor: 1000, currency: 'TRY' }, in_stock: false }]]));
    expect(n[0]!.price!.final_minor).toBe(900);
    expect(n[0]!.in_stock).toBe(false);
  });

  it('bozuk kayıt ayıklanır', () => {
    expect(parseCart('nope')).toEqual([]);
    expect(parseCart(JSON.stringify([{ product_id: 'x', qty: 1 }, { ...base(P1), qty: 2, added_at: 1 }])).map((i) => i.product_id)).toEqual([P1]);
  });
});
