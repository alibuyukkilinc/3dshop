import { describe, expect, it } from 'vitest';
import { fillSlots, inWindow, nearestStore } from './fill.js';

const slots = [
  { id: 'a', capacity: 1 },
  { id: 'b', capacity: 1 },
  { id: 'c', capacity: 2 },
];

describe('yerleşim çekirdeği (K23)', () => {
  it('pin önce, sonra kurallar sırayla, sonra varsayılan; ürün tekrar etmez', () => {
    const r = fillSlots(
      slots,
      [{ slotId: 'b', position: 0, itemId: 'p9' }],
      [
        { kind: 'rule', ruleId: 'r1', items: ['p9', 'p1'], limitPerSlot: 1 },
        { kind: 'default', ruleId: null, items: ['p1', 'p2', 'p3', 'p4'], limitPerSlot: Number.MAX_SAFE_INTEGER },
      ],
    );
    expect(r.map((x) => [x.slotId, x.position, x.itemId, x.source])).toEqual([
      ['a', 0, 'p1', 'rule'],
      ['b', 0, 'p9', 'pin'],
      ['c', 0, 'p2', 'default'],
      ['c', 1, 'p3', 'default'],
    ]);
  });

  it('kural limit_per_slot ile yuva başına sınırlanır; aday bitince boş kalır', () => {
    const r = fillSlots([{ id: 'c', capacity: 3 }], [], [{ kind: 'rule', ruleId: 'r', items: ['x', 'y', 'z'], limitPerSlot: 2 }]);
    expect(r.map((x) => x.itemId)).toEqual(['x', 'y']);
  });

  it('dolu pozisyona gelen ikinci pin ilk boş hücreye; kapasite dolunca atılır', () => {
    const r = fillSlots(
      [{ id: 'a', capacity: 1 }],
      [
        { slotId: 'a', position: 0, itemId: 'p1' },
        { slotId: 'a', position: 0, itemId: 'p2' },
        { slotId: 'yok', position: 0, itemId: 'p3' },
      ],
      [],
    );
    expect(r.map((x) => x.itemId)).toEqual(['p1']);
  });

  it('en yakın mağaza girişi (eşik içinde) ve geçerlilik penceresi', () => {
    const e = [
      { id: 's1', entrance: [0, 0, 0] as [number, number, number] },
      { id: 's2', entrance: [10, 0, 0] as [number, number, number] },
    ];
    expect(nearestStore([8, 0, 1], e)).toBe('s2');
    expect(nearestStore([100, 0, 0], e)).toBeNull();
    const now = new Date('2026-11-10T10:00:00Z');
    expect(inWindow(now, null, null)).toBe(true);
    expect(inWindow(now, new Date('2026-11-11T00:00:00Z'), null)).toBe(false);
    expect(inWindow(now, null, new Date('2026-11-10T10:00:00Z'))).toBe(false);
  });
});
