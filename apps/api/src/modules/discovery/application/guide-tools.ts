import { Injectable } from '@nestjs/common';
import { GUIDE_LIMITS, type GuideToolName, ToolInputs } from '../domain/guide.js';
import { StorefrontService } from './storefront.service.js';

const AI = 'ai' as const;

interface Price {
  final_minor: number;
  currency: string;
}
const price = (p: Price | null) => (p ? { amount: p.final_minor / 100, currency: p.currency } : null);

/** Bir istekteki araç çağrılarının topladığı izler: cevap doğrulaması bunlara bakar (K52). */
export interface ToolTrace {
  products: Set<string>;
  stores: Set<string>;
}

export type ToolOutcome = { ok: true; content: string } | { ok: false; content: string };

/**
 * Rehber araçları (K52): yalnız discovery facade'ı, yalnız ai kanalı görünürlüğüyle (K43). Fiyat ve stok
 * güncel aynadan gelir. Sonuçlar modele kısa JSON olarak gider; kimlikler izlere eklenir.
 */
@Injectable()
export class GuideTools {
  constructor(private readonly storefront: StorefrontService) {}

  async run(name: string, input: unknown, trace: ToolTrace): Promise<ToolOutcome> {
    if (!(name in ToolInputs)) return { ok: false, content: `Bilinmeyen araç: ${name}` };
    const parsed = ToolInputs[name as GuideToolName].safeParse(input);
    if (!parsed.success) return { ok: false, content: `Geçersiz girdi: ${parsed.error.issues[0]?.message ?? ''}` };
    const result = await this.exec(name as GuideToolName, parsed.data as never, trace);
    return { ok: true, content: JSON.stringify(result) };
  }

  private async exec(name: GuideToolName, input: Record<string, unknown>, trace: ToolTrace): Promise<unknown> {
    switch (name) {
      case 'search_products': {
        const { query, in_stock_only, max_price_try } = input as { query: string; in_stock_only: boolean; max_price_try: number | null };
        // Süzgeç sonrası yeterli sonuç kalsın diye geniş sayfa
        const r = await this.storefront.search(query, 1, AI, 40);
        const items = r.items
          .filter((p) => !in_stock_only || p.in_stock)
          .filter((p) => max_price_try === null || (p.price !== null && p.price.final_minor <= Math.round(max_price_try * 100)))
          .slice(0, GUIDE_LIMITS.toolResultProducts);
        for (const p of items) {
          trace.products.add(p.id);
          if (p.store) trace.stores.add(p.store.slug);
        }
        return {
          total_matches: r.total,
          items: items.map((p) => ({ id: p.id, name: p.name, store: p.store, price: price(p.price), in_stock: p.in_stock })),
        };
      }
      case 'get_product': {
        const p = await this.storefront.product((input as { product_id: string }).product_id, AI);
        if (!p) return { error: 'not_found' };
        trace.products.add(p.id);
        trace.stores.add(p.store.slug);
        return productDetail(p);
      }
      case 'compare_products': {
        const ids = (input as { product_ids: string[] }).product_ids;
        const rows = await Promise.all(ids.map((id) => this.storefront.product(id, AI)));
        return {
          items: rows.map((p, i) => {
            if (!p) return { id: ids[i], error: 'not_found' };
            trace.products.add(p.id);
            trace.stores.add(p.store.slug);
            return productDetail(p, false);
          }),
        };
      }
      case 'list_stores': {
        const stores = await this.storefront.stores(AI);
        for (const s of stores) trace.stores.add(s.slug);
        return { items: stores.map((s) => ({ slug: s.slug, name: s.name, company: s.company.display_name, product_count: s.product_count })) };
      }
      case 'get_store': {
        const slug = (input as { store_slug: string }).store_slug;
        const [s, products] = await Promise.all([
          this.storefront.store(slug, AI),
          this.storefront.storeProducts(slug, { sort: 'relevance', page: 1 }, AI),
        ]);
        if (!s) return { error: 'not_found' };
        trace.stores.add(s.slug);
        const top = (products?.items ?? []).slice(0, GUIDE_LIMITS.toolResultProducts);
        for (const p of top) trace.products.add(p.id);
        return {
          slug: s.slug,
          name: s.name,
          company: s.company.display_name,
          product_count: s.product_count,
          categories: s.facets.categories.map((c) => ({ name: c.name, count: c.count })).slice(0, 20),
          brands: s.facets.brands.map((b) => ({ name: b.name, count: b.count })).slice(0, 20),
          featured_products: top.map((p) => ({ id: p.id, name: p.name, price: price(p.price), in_stock: p.in_stock })),
        };
      }
      case 'route_to': {
        const slug = (input as { store_slug: string }).store_slug;
        const [s2d, s3d] = await Promise.all([this.storefront.store(slug, AI), this.storefront.store(slug, '3d')]);
        if (!s2d) return { error: 'not_found' };
        trace.stores.add(slug);
        return { store: s2d.name, city_url: s3d ? `/sehir?magaza=${slug}` : null, store_url: `/magaza/${slug}`, in_3d_city: Boolean(s3d) };
      }
    }
  }
}

type Detail = NonNullable<Awaited<ReturnType<StorefrontService['product']>>>;

function productDetail(p: Detail, withDescription = true) {
  return {
    id: p.id,
    name: p.name,
    store: { slug: p.store.slug, name: p.store.name },
    brand: p.brand?.name ?? null,
    category: p.primary_category?.name ?? null,
    price: price(p.price),
    in_stock: p.in_stock,
    variant_count: p.variants.length,
    ...(withDescription && { description: stripHtml(p.description_html).slice(0, 800) }),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
