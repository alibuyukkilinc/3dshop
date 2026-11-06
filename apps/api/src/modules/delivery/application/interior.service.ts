import { Injectable } from '@nestjs/common';
import { CatalogQuery } from '../../catalog/public/index.js';
import { CommerceFacts } from '../../commerce/public/index.js';
import { VisibilityService } from '../../rules/public/index.js';

const CHANNEL = '3d' as const;
/** Bir mağaza iç mekânında en çok ürün (performans tavanı; pilotta en büyük mağaza 371) */
export const INTERIOR_MAX_PRODUCTS = 600;
/** Koridor sayısı tavanı: fazlası "Diğer"e katılır */
export const INTERIOR_MAX_SECTIONS = 10;
/** Bu sayıdan az ürünlü grup kendi koridorunu almaz */
const MIN_SECTION = 4;
export const OTHER_SECTION = 'Diğer';

/** Kaynak CDN boyut eki (_high/_medium → _low ≈ 200 px): raf kartları küçük görselle */
export function thumbOf(url: string | null): string | null {
  return url ? url.replace(/_(high|medium)\.(webp|jpe?g|png)$/i, '_low.$2') : null;
}

export interface InteriorProduct {
  id: string;
  name: string;
  price: { final_minor: number; list_minor: number; currency: string } | null;
  in_stock: boolean;
  thumb: string | null;
}

/**
 * Ürünleri koridorlara böler: büyükten küçüğe, en çok INTERIOR_MAX_SECTIONS; küçük ve fazla gruplar ile
 * etiketsiz ürünler "Diğer"de (en sonda). Grup içi sıra korunur (çağıranın sıralaması: alaka/boost).
 */
export function toSections<T extends { id: string }>(items: T[], labels: Map<string, string>): { label: string; products: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const p of items) {
    const l = labels.get(p.id) ?? OTHER_SECTION;
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l)!.push(p);
  }
  const named = [...groups.entries()].filter(([l]) => l !== OTHER_SECTION).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'tr'));
  const keep = named.filter(([, ps]) => ps.length >= MIN_SECTION).slice(0, INTERIOR_MAX_SECTIONS - 1);
  const kept = new Set(keep.map(([l]) => l));
  const other = items.filter((p) => !kept.has(labels.get(p.id) ?? OTHER_SECTION));
  const out = keep.map(([label, products]) => ({ label, products }));
  if (other.length) out.push({ label: OTHER_SECTION, products: other });
  return out;
}

/**
 * Mağaza iç mekân verisi (K64): mağazanın 3d kanalında görünen tüm ürünleri, koridor gruplarıyla. İstemci iç
 * mekânı bundan kurar. Fiyat/stok aynadan (K41), görünürlük 3d kanalı (K43). Kısa HTTP önbelleği.
 */
@Injectable()
export class InteriorService {
  constructor(
    private readonly catalog: CatalogQuery,
    private readonly commerce: CommerceFacts,
    private readonly visibility: VisibilityService,
  ) {}

  async interior(slug: string) {
    const store = await this.commerce.storeBySlug(slug);
    if (!store || !(await this.visibility.visibleIds('store', CHANNEL, [store.id])).has(store.id)) return null;
    const ids = await this.visibility.visibleProductIdsOfStore(store.id, CHANNEL);
    const boosts = await this.visibility.boosts('product', CHANNEL);
    const [{ items, total }, labels] = await Promise.all([
      this.catalog.list({ productIds: ids, sort: 'relevance', offset: 0, limit: INTERIOR_MAX_PRODUCTS, boosts }),
      this.catalog.groupLabels(ids),
    ]);
    const products: InteriorProduct[] = items.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price ? { final_minor: p.price.final_minor, list_minor: p.price.list_minor, currency: p.price.currency } : null,
      in_stock: p.in_stock,
      thumb: thumbOf(p.image),
    }));
    // Öne çıkanlar: alaka sıralamasının başı, stokta ve görselli olanlar (giriş vitrini)
    const featured = products.filter((p) => p.in_stock && p.thumb).slice(0, 6).map((p) => ({ ...p, image: p.thumb!.replace(/_low\./, '_medium.') }));
    return {
      store: { id: store.id, slug: store.slug, name: store.name, company: store.company.display_name, logo_url: store.logo_url, icon_url: store.icon_url },
      total,
      truncated: total > items.length,
      featured,
      sections: toSections(products, labels),
    };
  }
}
