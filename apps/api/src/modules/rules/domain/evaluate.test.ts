import { describe, expect, it } from 'vitest';
import { ConditionSchema, evaluateCondition } from './condition.js';
import { type RuleDef, type Subject, evaluate } from './evaluate.js';

const now = new Date('2026-11-06T12:00:00Z');
let n = 0;
const rule = (p: Partial<RuleDef> & Pick<RuleDef, 'layer' | 'effect'>): RuleDef => ({
  id: `r${++n}`,
  code: p.code ?? `R${n}`,
  priority: 0,
  targets: [],
  channels: [],
  ...p,
});
const product = (facts: Subject['facts'] = {}): Subject => ({
  type: 'product',
  id: 'p1',
  refs: { store: ['s1'], category: ['c-root', 'c-inv'], brand: ['b-deye'], company: ['co1'] },
  facts: { 'product.source_status': 'active', 'store.status': 'active', 'product.stock': 5, ...facts },
});

const DEFAULT = rule({ code: 'DEFAULT', layer: 'default', effect: 'allow' });

describe('görünürlük değerlendirici: katmanlar (K43)', () => {
  it('yalnız varsayılan: görünür; hiç kural yoksa gizli (güvenli taraf)', () => {
    expect(evaluate([DEFAULT], product(), '2d', now)).toMatchObject({ visible: true, layer: 'default', decidedByCode: 'DEFAULT' });
    expect(evaluate([], product(), '2d', now)).toMatchObject({ visible: false, layer: null });
  });

  it('normal katman varsayılanı ezer; koşul sağlanmazsa uygulanmaz', () => {
    const inactive = rule({
      code: 'SOURCE_INACTIVE',
      layer: 'normal',
      effect: 'deny',
      condition: { fact: 'product.source_status', op: 'ne', value: 'active' },
    });
    expect(evaluate([DEFAULT, inactive], product(), '2d', now).visible).toBe(true);
    expect(evaluate([DEFAULT, inactive], product({ 'product.source_status': 'inactive' }), '2d', now)).toMatchObject({
      visible: false,
      layer: 'normal',
    });
  });

  it('istisna normal kuralı ezer', () => {
    const deny = rule({ layer: 'normal', effect: 'deny' });
    const exc = rule({ code: 'KEEP', layer: 'exception', effect: 'allow', targets: [{ type: 'product', id: 'p1', include: true }] });
    expect(evaluate([DEFAULT, deny, exc], product(), '2d', now)).toMatchObject({ visible: true, decidedByCode: 'KEEP' });
  });

  it('K8: hukuki engel hiçbir kanalda, en özgül ve en yüksek öncelikli istisnayla bile aşılamaz', () => {
    const legal = rule({ code: 'LEGAL', layer: 'mandatory_block', effect: 'deny', targets: [{ type: 'brand', id: 'b-deye', include: true }] });
    const exc = rule({ layer: 'exception', effect: 'allow', priority: 1_000_000, targets: [{ type: 'product', id: 'p1', include: true }] });
    for (const ch of ['3d', '2d', 'search', 'ai', 'seo', 'ads', 'campaign'] as const) {
      expect(evaluate([DEFAULT, exc, legal], product(), ch, now)).toMatchObject({ visible: false, layer: 'mandatory_block', decidedByCode: 'LEGAL' });
    }
  });
});

describe('aynı katmanda özgüllük, öncelik, eşitlikte deny', () => {
  it('ürün hedefi kategori hedefini, kategori mağazayı yener', () => {
    const storeDeny = rule({ layer: 'normal', effect: 'deny', targets: [{ type: 'store', id: 's1', include: true }] });
    const catAllow = rule({ code: 'CAT', layer: 'normal', effect: 'allow', targets: [{ type: 'category', id: 'c-inv', include: true }] });
    const prodDeny = rule({ code: 'PROD', layer: 'normal', effect: 'deny', targets: [{ type: 'product', id: 'p1', include: true }] });
    expect(evaluate([storeDeny, catAllow], product(), '2d', now)).toMatchObject({ visible: true, decidedByCode: 'CAT' });
    expect(evaluate([storeDeny, catAllow, prodDeny], product(), '2d', now)).toMatchObject({ visible: false, decidedByCode: 'PROD' });
  });

  it('aynı özgüllükte yüksek öncelik; o da eşitse deny kazanır', () => {
    const t = [{ type: 'brand' as const, id: 'b-deye', include: true }];
    const allowHi = rule({ code: 'HI', layer: 'normal', effect: 'allow', priority: 10, targets: t });
    const denyLo = rule({ layer: 'normal', effect: 'deny', priority: 5, targets: t });
    expect(evaluate([allowHi, denyLo], product(), '2d', now).decidedByCode).toBe('HI');
    const allowEq = rule({ layer: 'normal', effect: 'allow', priority: 5, targets: t });
    const denyEq = rule({ code: 'DENY_EQ', layer: 'normal', effect: 'deny', priority: 5, targets: t });
    expect(evaluate([allowEq, denyEq], product(), '2d', now)).toMatchObject({ visible: false, decidedByCode: 'DENY_EQ' });
    expect(evaluate([denyEq, allowEq], product(), '2d', now)).toMatchObject({ visible: false, decidedByCode: 'DENY_EQ' });
  });

  it('dışlama hedefi kuralı o hedeften çeker; kanal kısıtı uyar', () => {
    const deny3d = rule({
      layer: 'normal',
      effect: 'deny',
      channels: ['3d'],
      targets: [
        { type: 'store', id: 's1', include: true },
        { type: 'category', id: 'c-inv', include: false },
      ],
    });
    expect(evaluate([DEFAULT, deny3d], product(), '3d', now).visible).toBe(true);
    const deny3dOnly = rule({ layer: 'normal', effect: 'deny', channels: ['3d'] });
    expect(evaluate([DEFAULT, deny3dOnly], product(), '3d', now).visible).toBe(false);
    expect(evaluate([DEFAULT, deny3dOnly], product(), '2d', now).visible).toBe(true);
  });

  it('geçerlilik aralığı dışındaki kural uygulanmaz; adımlarda nedeni yazılır', () => {
    const later = rule({ code: 'LATER', layer: 'normal', effect: 'deny', validFrom: new Date('2027-01-01') });
    const d = evaluate([DEFAULT, later], product(), '2d', now);
    expect(d.visible).toBe(true);
    expect(d.steps.find((s) => s.rule === 'LATER')).toMatchObject({ applies: false, note: 'geçerlilik dışında' });
  });

  it('boost/demote karar vermez, görünür sonuçta çarpılır', () => {
    const boost = rule({ layer: 'normal', effect: 'boost', params: { factor: 2 } });
    const demote = rule({ layer: 'default', effect: 'demote', params: { factor: 4 } });
    expect(evaluate([DEFAULT, boost, demote], product(), '2d', now)).toMatchObject({ visible: true, boost: 0.5, layer: 'default' });
    expect(evaluate([boost], product(), '2d', now).visible).toBe(false);
  });
});

describe('koşul DSL', () => {
  const f = { 'product.stock': 0, 'product.price_final': 1000, 'category.ids': ['a', 'b'], 'store.status': 'active' };
  it('karşılaştırmalar, diziler, mantık', () => {
    expect(evaluateCondition({ fact: 'product.stock', op: 'lte', value: 0 }, f)).toBe(true);
    expect(evaluateCondition({ fact: 'category.ids', op: 'eq', value: 'b' }, f)).toBe(true);
    expect(evaluateCondition({ fact: 'category.ids', op: 'in', value: ['x', 'a'] }, f)).toBe(true);
    expect(evaluateCondition({ fact: 'category.ids', op: 'nin', value: ['a'] }, f)).toBe(false);
    expect(evaluateCondition({ all: [{ fact: 'store.status', op: 'eq', value: 'active' }, { not: { fact: 'yok', op: 'exists' } }] }, f)).toBe(true);
    expect(evaluateCondition({ fact: 'product.price_final', op: 'gt', value: '5' }, f)).toBe(false);
  });
  it('şema: bilinmeyen anahtar ve operatör reddedilir (kod çalıştırılamaz)', () => {
    expect(ConditionSchema.safeParse({ fact: 'product.stock', op: 'eq', value: 1 }).success).toBe(true);
    expect(ConditionSchema.safeParse({ fact: 'product.stock', op: 'eval', value: '1' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ fact: 'x', op: 'eq', value: 1, fn: 'alert(1)' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ all: [] }).success).toBe(false);
  });
});
