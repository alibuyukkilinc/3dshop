import { type ProductV1, ProductV1Schema, toMinor } from '@dtd/contracts';
import type { EticaretProduct } from './export-schema.js';

export const ETICARET_SYSTEM = 'eticaret_legacy';

/** Kaynakta "marka yok" anlamına gelen üretici değerleri (ticari-yapi, A2). "Genel" gibi değerler eşlemede ele alınır. */
const NO_BRAND = new Set(['', 'id0']);

/**
 * eticaret export ürününü ortak sözleşmeye çevirir (katalog dalı: alan eşlemesi).
 * - Fiyat yalnız price_final / price_list'ten gelir; sell_price, discounted_price kullanılmaz, buy_price hiç okunmaz (K41).
 * - supplier_status=0: ürün sitede görünmez → inactive (kaynakta pasifle aynı muamele).
 * - price_final null (sitede hideprice): fiyatsız ürün, price = null.
 */
export function toProductV1(raw: EticaretProduct, site: string): ProductV1 {
  const active = raw.status === 1 && raw.supplier_status === 1;
  const brand = NO_BRAND.has(raw.manufacturer.toLowerCase()) ? null : { source_name: raw.manufacturer };

  const i18n: ProductV1['i18n'] = {};
  for (const [code, t] of Object.entries(raw.langs)) {
    i18n[code.toLowerCase()] = { name: t.name, description_html: t.description };
  }

  const categories = new Map<string, string>();
  for (const name of raw.categories) {
    const id = categoryKey(name);
    if (id && !categories.has(id)) categories.set(id, name.trim());
  }

  const price: ProductV1['price'] =
    raw.price_final === null
      ? null
      : {
          final_minor: toMinor(raw.price_final),
          // Yuvarlama indirimli fiyatı listeden yukarı itebilir; kaynak bunu düzeltiyor, burada da güvence
          list_minor: Math.max(toMinor(raw.price_list ?? raw.price_final), toMinor(raw.price_final)),
          currency: (raw.price_currency ?? 'TRY').toUpperCase(),
          tax_included: true,
          valid_until: raw.price_valid_until,
        };

  const product: ProductV1 = {
    contract: 'commerce.product.v1',
    source: {
      system: ETICARET_SYSTEM,
      site,
      external_id: String(raw.product_id),
      updated_at: raw.date_updated,
    },
    status: active ? 'active' : 'inactive',
    identifiers: {
      sku: raw.sku || null,
      barcode: raw.barcode || null,
      mpn: raw.mpn || null,
      model_code: raw.model_code || raw.model || null,
    },
    brand,
    i18n,
    categories: [...categories].map(([external_id, name]) => ({ external_id, name })),
    price,
    stock: { quantity: raw.stock },
    variants: raw.options.map((o) => ({
      external_ref: `${o.option_group_id}:${o.option_id}`,
      options: [{ group: o.group_name || o.group_code, value: o.option_name || o.option_value || o.option_code }],
      sku: null,
      price: o.price_final === null || o.price_final === undefined || price === null ? null : { final_minor: toMinor(o.price_final) },
      stock: { quantity: o.stock ?? o.quantity },
    })),
    media: [...new Set(raw.images.map((u) => u.trim()))]
      .filter(isAbsoluteHttpUrl)
      .map((url) => ({ kind: 'image' as const, url })),
    url: raw.url && isAbsoluteHttpUrl(raw.url) ? raw.url : null,
    physical:
      raw.isnot_physical === 1
        ? null
        : {
            weight: raw.weight > 0 ? raw.weight : null,
            dims:
              raw.width > 0 || raw.height > 0 || raw.depth > 0
                ? { width: raw.width, height: raw.height, depth: raw.depth }
                : null,
          },
  };
  return ProductV1Schema.parse(product);
}

/** Export kategori kimliği vermiyor, yalnız adı: aynı ad aynı kategori sayılır. */
export function categoryKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr');
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
