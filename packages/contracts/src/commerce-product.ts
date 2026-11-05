import { z } from 'zod';

/**
 * Ortak ürün sözleşmesi v1 (Cortex: katalog, K06, K41). Her kaynak adaptörü kendi verisini bu biçime çevirir;
 * catalog modülü yalnız bunu bilir. Para kuruş (minor) cinsinden tam sayıdır (K33); fiyat kaynakta hesaplanmış
 * son fiyattır, platform fiyat hesaplamaz (K41). Alış fiyatı ve tedarikçi bu sözleşmede YOKTUR.
 */
const Minor = z.number().int().nonnegative();

export const PriceV1Schema = z.object({
  final_minor: Minor,
  list_minor: Minor,
  currency: z.string().length(3),
  tax_included: z.boolean(),
  /** Aktif indirimin bitişi; bu anda ürün yeniden çekilir (K42) */
  valid_until: z.iso.datetime({ offset: true }).nullable(),
});
export type PriceV1 = z.infer<typeof PriceV1Schema>;

export const ProductVariantV1Schema = z.object({
  /** Kaynakta kararlı kimlik, örn. eticaret için "<option_group_id>:<option_id>" */
  external_ref: z.string().min(1),
  options: z.array(z.object({ group: z.string(), value: z.string() })),
  sku: z.string().nullable(),
  /** null: fiyat gizli (kaynakta hideprice) */
  price: z.object({ final_minor: Minor }).nullable(),
  stock: z.object({ quantity: z.number().int() }),
});
export type ProductVariantV1 = z.infer<typeof ProductVariantV1Schema>;

export const ProductV1Schema = z.object({
  contract: z.literal('commerce.product.v1'),
  source: z.object({
    system: z.string().min(1),
    site: z.string().min(1),
    external_id: z.string().min(1),
    /** Kaynağın kendi değişiklik zamanı, kaynak biçiminde (filigran için; K42) */
    updated_at: z.string().min(1),
  }),
  /** active: kaynak sitede satışta ve görünür. inactive: kaynakta pasif veya sitede gizli */
  status: z.enum(['active', 'inactive']),
  identifiers: z.object({
    sku: z.string().nullable(),
    barcode: z.string().nullable(),
    mpn: z.string().nullable(),
    model_code: z.string().nullable(),
  }),
  brand: z.object({ source_name: z.string() }).nullable(),
  i18n: z.record(z.string(), z.object({ name: z.string(), description_html: z.string() })),
  categories: z.array(z.object({ external_id: z.string().min(1), name: z.string() })),
  /** null: fiyatsız ürün (kaynakta fiyat gizli) */
  price: PriceV1Schema.nullable(),
  stock: z.object({ quantity: z.number().int() }),
  variants: z.array(ProductVariantV1Schema),
  media: z.array(z.object({ kind: z.literal('image'), url: z.url() })),
  /** Satın alma kaynak sitede (K14) */
  url: z.url().nullable(),
  physical: z
    .object({
      weight: z.number().nonnegative().nullable(),
      dims: z.object({ width: z.number(), height: z.number(), depth: z.number() }).nullable(),
    })
    .nullable(),
});
export type ProductV1 = z.infer<typeof ProductV1Schema>;

/**
 * Ondalık para metnini/sayısını kuruşa çevirir; kayan nokta aritmetiği yapmaz (K33).
 * "1249.9" → 124990, 14708.9 → 1470890. Üçüncü ondalık hane varsa yarım yukarı yuvarlanır.
 */
export function toMinor(value: number | string): number {
  const text = typeof value === 'number' ? numberToPlain(value) : value.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`Para değeri tanınmadı: ${String(value)}`);
  const whole = BigInt(m[1]!);
  const frac = (m[2] ?? '').padEnd(3, '0');
  let minor = whole * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) minor += 1n;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Para değeri çok büyük: ${text}`);
  return Number(minor);
}

/** JSON sayısını üstel gösterim olmadan metne çevirir (1e-7 gibi değerler kaynakta beklenmez ama reddedilir). */
function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`Para değeri geçersiz: ${n}`);
  const s = String(n);
  if (s.includes('e')) throw new Error(`Para değeri tanınmadı: ${s}`);
  return s;
}
