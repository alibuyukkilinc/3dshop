import { type Condition, type Facts, evaluateCondition } from './condition.js';

/**
 * Görünürlük değerlendirici (K43, kural-motoru dalı). Saf fonksiyon: veritabanı yok, test tablolarıyla sınanır.
 *
 * 1. Katman sırası: mandatory_block → exception → normal → default. Görünürlüğe karar veren (allow/deny)
 *    kuralı olan İLK katman kazanır. Böylece hiçbir istisna, kanal ayarı ya da yönetici hukuki engeli aşamaz.
 * 2. Aynı katmanda özgül hedef kazanır: variant > product > category > store > brand > company > region > world.
 * 3. Eşitlikte priority (büyük kazanır); o da eşitse deny kazanır.
 * boost/demote görünürlüğe karar vermez; görünür sonuçta sıralama katsayısı olarak çarpılır.
 */
export const LAYERS = ['mandatory_block', 'exception', 'normal', 'default'] as const;
export type Layer = (typeof LAYERS)[number];
export const CHANNELS = ['3d', '2d', 'search', 'ai', 'seo', 'ads', 'campaign'] as const;
export type Channel = (typeof CHANNELS)[number];
export const TARGET_TYPES = ['world', 'region', 'company', 'brand', 'store', 'category', 'product', 'variant', 'asset', 'place'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export type Effect = 'allow' | 'deny' | 'boost' | 'demote';

const SPECIFICITY: Record<TargetType, number> = {
  variant: 8,
  product: 7,
  asset: 7,
  place: 7,
  category: 6,
  store: 5,
  brand: 4,
  company: 3,
  region: 2,
  world: 1,
};

export interface RuleDef {
  id: string;
  code: string;
  layer: Layer;
  effect: Effect;
  /** boost/demote katsayısı, örn. {"factor": 1.5} */
  params?: { factor?: number };
  condition?: Condition | null;
  priority: number;
  /** Boşsa kural tüm hedeflere uygulanır (en düşük özgüllük) */
  targets: { type: TargetType; id: string | null; include: boolean }[];
  /** Boşsa tüm kanallar */
  channels: Channel[];
  validFrom?: Date | null;
  validTo?: Date | null;
}

/** Değerlendirilen hedefin kimlikleri: ürün kendi kategorileri, mağazası, markası, firmasıyla gelir. */
export interface Subject {
  type: 'product' | 'store';
  id: string;
  /** Hedef türü → bu hedefi kapsayan kimlikler (ürün için kategori ataları dahil) */
  refs: Partial<Record<TargetType, string[]>>;
  facts: Facts;
}

export interface Step {
  rule: string;
  layer: Layer;
  effect: Effect;
  applies: boolean;
  specificity: number;
  note?: string;
}

export interface Decision {
  visible: boolean;
  boost: number;
  layer: Layer | null;
  decidedBy: string | null;
  /** Karar veren kural kodu; insan okur */
  decidedByCode: string | null;
  steps: Step[];
}

/** Kuralın bu hedefe ne kadar özgül uyduğu; uymuyorsa -1. Hedefsiz kural 0. */
export function matchSpecificity(rule: RuleDef, subject: Subject): number {
  const includes = rule.targets.filter((t) => t.include);
  const excludes = rule.targets.filter((t) => !t.include);
  const hits = (t: RuleDef['targets'][number]) =>
    t.type === subject.type ? t.id === null || t.id === subject.id : t.id === null ? (subject.refs[t.type]?.length ?? 0) > 0 : (subject.refs[t.type] ?? []).includes(t.id);
  if (excludes.some(hits)) return -1;
  if (includes.length === 0) return 0;
  let best = -1;
  for (const t of includes) if (hits(t)) best = Math.max(best, t.id === null ? 0 : SPECIFICITY[t.type]);
  return best;
}

export function evaluate(rules: RuleDef[], subject: Subject, channel: Channel, now: Date): Decision {
  const facts: Facts = { ...subject.facts, channel, now: now.toISOString() };
  const steps: Step[] = [];
  const applicable: (RuleDef & { spec: number })[] = [];

  for (const r of rules) {
    if (r.channels.length > 0 && !r.channels.includes(channel)) continue;
    const spec = matchSpecificity(r, subject);
    if (spec < 0) continue;
    let note: string | undefined;
    let applies = true;
    if ((r.validFrom && r.validFrom > now) || (r.validTo && r.validTo <= now)) {
      applies = false;
      note = 'geçerlilik dışında';
    } else if (!evaluateCondition(r.condition, facts)) {
      applies = false;
      note = 'koşul sağlanmadı';
    }
    steps.push({ rule: r.code, layer: r.layer, effect: r.effect, applies, specificity: spec, ...(note && { note }) });
    if (applies) applicable.push({ ...r, spec });
  }

  for (const layer of LAYERS) {
    const deciding = applicable.filter((r) => r.layer === layer && (r.effect === 'allow' || r.effect === 'deny'));
    if (deciding.length === 0) continue;
    deciding.sort((a, b) => b.spec - a.spec || b.priority - a.priority || (a.effect === 'deny' ? -1 : 0) - (b.effect === 'deny' ? -1 : 0));
    const winner = deciding[0]!;
    const visible = winner.effect === 'allow';
    let boost = 1;
    if (visible) {
      for (const r of applicable) {
        const f = r.params?.factor;
        if (r.effect === 'boost' && f && f > 0) boost *= f;
        if (r.effect === 'demote' && f && f > 0) boost /= f;
      }
    }
    return { visible, boost: Math.round(boost * 1000) / 1000, layer, decidedBy: winner.id, decidedByCode: winner.code, steps };
  }
  // Hiçbir kural karar vermedi: güvenli taraf gizli
  return { visible: false, boost: 1, layer: null, decidedBy: null, decidedByCode: null, steps };
}
