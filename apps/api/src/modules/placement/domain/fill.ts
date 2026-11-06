/**
 * Yerleşim çekirdeği (A5, K23), saf fonksiyon. Bir mağazanın yuvalarını doldurur:
 * 1. Elle pin her zaman önce gelir (görünür değilse çağıran zaten elemiştir).
 * 2. Kurallar öncelik sırasıyla; her kural bir yuvaya en çok limit_per_slot öğe koyar.
 * 3. Kalan boşlukları varsayılan kaynak (mağazanın ürünleri, alaka sırası) doldurur.
 * Aynı ürün aynı mağazanın yuvalarında bir kez görünür.
 */
export type PlacementSource = 'pin' | 'rule' | 'default';

export interface SlotIn {
  id: string;
  capacity: number;
}
export interface PinIn {
  slotId: string;
  position: number;
  itemId: string;
}
export interface SourceIn {
  kind: 'rule' | 'default';
  ruleId: string | null;
  /** Sıralı aday ürünler */
  items: string[];
  limitPerSlot: number;
}
export interface Placed {
  slotId: string;
  position: number;
  itemId: string;
  source: PlacementSource;
  ruleId: string | null;
}

export function fillSlots(slots: SlotIn[], pins: PinIn[], sources: SourceIn[]): Placed[] {
  const used = new Set<string>();
  const grid = new Map<string, (Placed | null)[]>(slots.map((s) => [s.id, Array.from({ length: s.capacity }, () => null)]));

  for (const p of [...pins].sort((a, b) => a.position - b.position)) {
    const cells = grid.get(p.slotId);
    if (!cells || used.has(p.itemId)) continue;
    // Pozisyon doluysa ya da kapasite dışındaysa ilk boş hücreye
    const at = p.position < cells.length && !cells[p.position] ? p.position : cells.indexOf(null);
    if (at < 0) continue;
    cells[at] = { slotId: p.slotId, position: at, itemId: p.itemId, source: 'pin', ruleId: null };
    used.add(p.itemId);
  }

  for (const src of sources) {
    let next = 0;
    const take = () => {
      while (next < src.items.length) {
        const id = src.items[next++]!;
        if (!used.has(id)) return id;
      }
      return null;
    };
    for (const s of slots) {
      const cells = grid.get(s.id)!;
      let placedHere = 0;
      for (let i = 0; i < cells.length && placedHere < src.limitPerSlot; i++) {
        if (cells[i]) continue;
        const id = take();
        if (!id) break;
        cells[i] = { slotId: s.id, position: i, itemId: id, source: src.kind, ruleId: src.ruleId };
        used.add(id);
        placedHere++;
      }
    }
  }

  return [...grid.values()].flatMap((cells) => cells.filter((c): c is Placed => c !== null));
}

export type V3 = [number, number, number];

/** Vitrin yuvasını en yakın mağaza girişine bağlar (yatay mesafe, eşik metre); yakında giriş yoksa null. */
export function nearestStore(slot: V3, entrances: { id: string; entrance: V3 }[], maxM = 20): string | null {
  let best: { id: string; d: number } | null = null;
  for (const e of entrances) {
    const d = Math.hypot(slot[0] - e.entrance[0], slot[2] - e.entrance[2]);
    if (d <= maxM && (!best || d < best.d)) best = { id: e.id, d };
  }
  return best?.id ?? null;
}

/** Geçerlilik penceresi (kural/pin). */
export function inWindow(now: Date, from: Date | null, to: Date | null): boolean {
  return (!from || from <= now) && (!to || now < to);
}
