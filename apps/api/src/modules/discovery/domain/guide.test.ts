import { describe, expect, it } from 'vitest';
import { checkAnswer } from './guide.js';

const A = '01934f2a-7b3c-7d4e-8f50-0000000000aa';
const B = '01934f2a-7b3c-7d4e-8f50-0000000000bb';
const seen = new Set([A]);
const stores = new Set(['esen']);
const j = (o: object) => JSON.stringify({ answer: 'Tamam.', product_ids: [], store_slugs: [], navigate_store: null, ...o });

describe('rehber cevap doğrulaması (K52)', () => {
  it('görülen ürün ve görünür mağaza kabul edilir; tekrarlar ayıklanır', () => {
    const r = checkAnswer(j({ product_ids: [A, A], store_slugs: ['esen'], navigate_store: 'esen' }), seen, stores);
    expect(r).toMatchObject({ ok: true, answer: { product_ids: [A], store_slugs: ['esen'] } });
  });

  it('görülmemiş ürün, bilinmeyen mağaza, fiyat rakamı ve bozuk JSON reddedilir', () => {
    expect(checkAnswer(j({ product_ids: [B] }), seen, stores)).toEqual({ ok: false, reason: 'unknown_product' });
    expect(checkAnswer(j({ navigate_store: 'baska' }), seen, stores)).toEqual({ ok: false, reason: 'unknown_store' });
    expect(checkAnswer(j({ answer: 'Fiyatı 1.250 TL.' }), seen, stores)).toEqual({ ok: false, reason: 'price_in_text' });
    expect(checkAnswer(j({ answer: '₺499 civarı' }), seen, stores)).toEqual({ ok: false, reason: 'price_in_text' });
    expect(checkAnswer('{"answer":', seen, stores)).toEqual({ ok: false, reason: 'unparseable' });
    expect(checkAnswer(JSON.stringify({ answer: 'x' }), seen, stores)).toEqual({ ok: false, reason: 'unparseable' });
  });

  it('fiyat dışı sayılar serbest (12V akü, 5 kW)', () => {
    expect(checkAnswer(j({ answer: '12V akü ve 5 kW inverter seçenekleri var.' }), seen, stores).ok).toBe(true);
  });
});
