import { z } from 'zod';

/**
 * AI rehber (K52) — saf kısım: sistem istemi, araç tanımları, cevap şeması ve cevap doğrulaması.
 * Model yalnız bu araçlarla, ai kanalında görünen veriyi görür; cevabındaki her ürün araç sonucundan gelmek
 * zorundadır (sunucu doğrular, uyduran cevap düşürülür ve klasik aramaya geçilir).
 */

export const GUIDE_LIMITS = {
  /** Soru metni */
  messageMaxChars: 500,
  /** Oturum başına soru; aşılınca yeni oturum */
  turnsPerSession: 10,
  /** Bir soru için en çok model çağrısı (araç turları dahil) */
  callsPerQuestion: 5,
  /** Cevapta en çok ürün kartı / mağaza */
  maxProducts: 6,
  maxStores: 4,
  answerMaxChars: 1200,
  /** Araç sonucunda en çok ürün */
  toolResultProducts: 8,
  /** Sohbet saklama (K52) */
  retentionDays: 30,
} as const;

export const GUIDE_SYSTEM_PROMPT = `Sen "Dijital Ticaret Dünyası" sitesinin alışveriş rehberisin. Site, gerçek mağazaların ürünlerini 2D katalogda ve 3D şehirde gösterir; satın alma her zaman mağazanın kendi sitesinde yapılır.

Görevin: ziyaretçinin aradığı ürünü ya da mağazayı araçlarla bulup kısa, doğru bir Türkçe cevap vermek.

Kurallar:
- Ürün, mağaza, fiyat ve stok bilgisini yalnız araç sonuçlarından al. Araç sonucunda olmayan bir ürünü, özelliği ya da mağazayı asla anma ve tahmin etme. Bulamazsan bunu açıkça söyle ve aramayı nasıl daraltabileceğini öner.
- Cevap metnine fiyat rakamı yazma: ürün kartları güncel fiyatı ayrıca gösterir. "Daha uygun", "en ucuzu" gibi karşılaştırmalar yapabilirsin.
- Önerdiğin ürünlerin kimliklerini product_ids alanına, andığın mağazaların slug değerlerini store_slugs alanına yaz. Metinde kimlik ya da slug yazma.
- Ziyaretçi bir mağazaya 3D şehirde gitmek isterse route_to aracını kullan ve navigate_store alanına mağazanın slug değerini yaz.
- Site dışı konularda (sağlık, hukuk, yatırım tavsiyesi, genel sohbet) kibarca yalnız alışverişte yardımcı olabileceğini söyle.
- Kişisel bilgi (ad, telefon, adres, e-posta) isteme.
- Cevap kısa olsun: en çok 3-4 cümle.`;

/** Strict araç şemaları: tüm alanlar zorunlu, ek alan yok (isteğe bağlı olanlar null alabilir). */
const obj = (properties: Record<string, unknown>) => ({
  type: 'object' as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const GUIDE_TOOLS = [
  {
    name: 'search_products',
    description:
      'Görünür ürünlerde metinle arar (ad ve açıklama, Türkçe, yazım hatasına dayanıklı). En çok 8 ürün döner: kimlik, ad, mağaza, fiyat, stok.',
    input_schema: obj({
      query: { type: 'string', description: 'Arama ifadesi, örn. "12V akü" ya da "hibrit inverter"' },
      in_stock_only: { type: 'boolean', description: 'Yalnız stokta olanlar' },
      max_price_try: { type: ['number', 'null'], description: 'En yüksek fiyat (TL); sınır yoksa null' },
    }),
  },
  {
    name: 'get_product',
    description: 'Bir ürünün ayrıntısı: ad, mağaza, marka, kategori, fiyat, stok, seçenekler, kısa açıklama.',
    input_schema: obj({ product_id: { type: 'string', description: 'search_products sonucundaki ürün kimliği' } }),
  },
  {
    name: 'compare_products',
    description: '2-4 ürünü yan yana getirir (fiyat, stok, marka, kategori, seçenek sayısı).',
    input_schema: obj({ product_ids: { type: 'array', items: { type: 'string' }, description: '2-4 ürün kimliği' } }),
  },
  {
    name: 'list_stores',
    description: 'Sitedeki görünür mağazalar: slug, ad, firma, ürün sayısı.',
    input_schema: obj({}),
  },
  {
    name: 'get_store',
    description: 'Bir mağazanın kategorileri, markaları ve öne çıkan ürünleri.',
    input_schema: obj({ store_slug: { type: 'string' } }),
  },
  {
    name: 'route_to',
    description: 'Ziyaretçiyi mağazaya götürecek bağlantılar: 3D şehirde mağaza girişi ve 2D mağaza sayfası.',
    input_schema: obj({ store_slug: { type: 'string' } }),
  },
] as const;

export type GuideToolName = (typeof GUIDE_TOOLS)[number]['name'];

export const ToolInputs = {
  search_products: z.object({
    query: z.string().trim().min(1).max(100),
    in_stock_only: z.boolean(),
    max_price_try: z.number().positive().max(100_000_000).nullable(),
  }),
  get_product: z.object({ product_id: z.uuid() }),
  compare_products: z.object({ product_ids: z.array(z.uuid()).min(2).max(4) }),
  list_stores: z.object({}),
  get_store: z.object({ store_slug: z.string().regex(/^[a-z0-9-]{2,80}$/) }),
  route_to: z.object({ store_slug: z.string().regex(/^[a-z0-9-]{2,80}$/) }),
} satisfies Record<GuideToolName, z.ZodType>;

/** Son cevabın biçimi (structured outputs). */
export const ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    product_ids: { type: 'array', items: { type: 'string' } },
    store_slugs: { type: 'array', items: { type: 'string' } },
    navigate_store: { type: ['string', 'null'] },
  },
  required: ['answer', 'product_ids', 'store_slugs', 'navigate_store'],
  additionalProperties: false,
} as const;

export const AnswerSchema = z.object({
  answer: z.string().trim().min(1),
  product_ids: z.array(z.string()),
  store_slugs: z.array(z.string()),
  navigate_store: z.string().nullable(),
});
export type GuideAnswer = z.infer<typeof AnswerSchema>;

/** Metinde para tutarı (rakam + TL/₺/TRY): model fiyat yazmamalı; yazarsa doğrulanamaz sayılır. */
const PRICE_IN_TEXT = /\d[\d.,]*\s*(?:TL|₺|TRY)\b|₺\s*\d/i;

export type AnswerCheck = { ok: true; answer: GuideAnswer } | { ok: false; reason: 'unparseable' | 'unknown_product' | 'unknown_store' | 'price_in_text' };

/**
 * Cevabı doğrular (K52): JSON şemaya uymalı; her ürün bu oturumda araç sonucunda görülmüş, her mağaza ai
 * kanalında görünür olmalı; metin fiyat rakamı içermemeli. Fazlası kırpılır, bilinmeyen tek kayıt bile reddettirir.
 */
export function checkAnswer(raw: string, seenProducts: ReadonlySet<string>, visibleStores: ReadonlySet<string>): AnswerCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  const r = AnswerSchema.safeParse(parsed);
  if (!r.success) return { ok: false, reason: 'unparseable' };
  const a = r.data;
  if (a.product_ids.some((id) => !seenProducts.has(id))) return { ok: false, reason: 'unknown_product' };
  const stores = [...a.store_slugs, ...(a.navigate_store ? [a.navigate_store] : [])];
  if (stores.some((s) => !visibleStores.has(s))) return { ok: false, reason: 'unknown_store' };
  if (PRICE_IN_TEXT.test(a.answer)) return { ok: false, reason: 'price_in_text' };
  return {
    ok: true,
    answer: {
      answer: a.answer.slice(0, GUIDE_LIMITS.answerMaxChars),
      product_ids: [...new Set(a.product_ids)].slice(0, GUIDE_LIMITS.maxProducts),
      store_slugs: [...new Set(a.store_slugs)].slice(0, GUIDE_LIMITS.maxStores),
      navigate_store: a.navigate_store,
    },
  };
}
