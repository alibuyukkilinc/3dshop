import { z } from 'zod';

/**
 * eticaret API v2 export yanıtı (GET /api/v2/admin/products/export). Kaynak:
 * eticaret api/modules/admin/v2/infrastructure/persistence/PdoAdminProductRepository.php (exportSince) ve
 * ExportAdminProductsUseCase (price_final, url; 999bfe4a). Bilinmeyen alanlar yok sayılır; buy_price ve
 * supplier gibi alanlar bilerek ŞEMADA YOK: çözümlenen nesneye hiç girmezler (K41).
 */
const Num = z.number();
const Text = z.string().nullish().transform((v) => (v ?? '').trim());

export const EticaretOptionSchema = z.object({
  option_group_id: z.number().int(),
  option_id: z.number().int(),
  group_code: Text,
  group_name: Text,
  option_code: Text,
  option_name: Text,
  option_value: Text,
  quantity: z.number().int(),
  /** 999bfe4a: seçenek bazında son fiyat; hideprice açıksa ürün fiyatı null olur */
  price_final: Num.nullable().optional(),
  stock: z.number().int().optional(),
});

/** PHP boş diziyi [] olarak, dolu ilişkisel diziyi nesne olarak kodlar. */
const Langs = z.union([
  z.array(z.never()).transform(() => ({})),
  z.record(z.string(), z.object({ name: Text, description: Text })),
]);

export const EticaretProductSchema = z.object({
  product_id: z.number().int().positive(),
  barcode: Text,
  sku: Text,
  model: Text,
  model_code: Text,
  mpn: Text,
  stock: z.number().int(),
  status: z.number().int(),
  supplier_status: z.number().int(),
  weight: Num,
  width: Num,
  height: Num,
  depth: Num,
  isnot_physical: z.number().int(),
  manufacturer: Text,
  date_updated: z.string().min(1),
  langs: Langs,
  images: z.array(z.string()),
  categories: z.array(z.string()),
  options: z.array(EticaretOptionSchema),
  price_final: Num.nullable(),
  price_list: Num.nullable(),
  price_currency: z.string().nullable(),
  price_valid_until: z.string().nullable(),
  url: z.string().nullable(),
});
export type EticaretProduct = z.infer<typeof EticaretProductSchema>;

export const EticaretExportPageSchema = z.object({
  success: z.literal(true),
  data: z.object({
    // Öğeler tek tek doğrulanır: bozuk bir ürün tüm sayfayı düşürmesin
    items: z.array(z.unknown()),
    next_cursor: z.number().int().nonnegative(),
    has_more: z.boolean(),
  }),
});
