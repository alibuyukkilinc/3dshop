import { Injectable } from '@nestjs/common';
import { type RedirectChannel, RedirectsService } from '../../analytics/public/index.js';
import { CatalogQuery, type ProductSort } from '../../catalog/public/index.js';
import { CommerceFacts } from '../../commerce/public/index.js';
import { type Channel, VisibilityService } from '../../rules/public/index.js';
import { WorldService } from '../../world/public/index.js';

export const PAGE_SIZE = 24;

/**
 * 2D vitrin okuma yolu (F2.3). Her şey önce görünürlükten geçer (K43): mağaza ve ürün "2d" kanalında
 * görünmüyorsa yok sayılır (404). Kaynaklar yalnız public facade'lar (K50, K51).
 */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly visibility: VisibilityService,
    private readonly catalog: CatalogQuery,
    private readonly commerce: CommerceFacts,
    private readonly redirects: RedirectsService,
    private readonly world: WorldService,
  ) {}

  /** Türkiye haritası pinleri (F4.3): 2d kanalında görünen mağazaların şubeleri. Konum hassasiyeti açıkça döner. */
  async mapPins() {
    const visible = await this.visibility.visibleIds('store', '2d');
    const stores = new Map((await this.commerce.publicStores([...visible])).map((s) => [s.id, s]));
    const branches = await this.world.branches([...visible]);
    return branches
      .filter((b) => b.geo && b.store_id && stores.has(b.store_id))
      .map((b) => {
        const s = stores.get(b.store_id!)!;
        return {
          id: b.place_id,
          store: { slug: s.slug, name: s.name },
          lat: b.geo!.lat,
          lng: b.geo!.lng,
          precision: b.geo!.precision,
          place: [b.geo!.district, b.geo!.province].filter(Boolean).join(', '),
        };
      });
  }

  /** Arama (search kanalı): görünen ürünler arasında; mağaza gizliyse ürün de gizli (mağaza kuralı ürüne uygulanır). */
  async search(q: string, page: number, channel: Channel = 'search', pageSize = PAGE_SIZE) {
    const ids = [...(await this.visibility.visibleIds('product', channel))];
    const r = await this.catalog.search(q, ids, (page - 1) * pageSize, pageSize);
    const stores = await this.commerce.publicStores([...new Set(r.items.map((i) => i.store_id))]);
    const storeBy = new Map(stores.map((s) => [s.id, { slug: s.slug, name: s.name }]));
    return { q, total: r.total, page, page_size: pageSize, items: r.items.map((i) => ({ ...i, store: storeBy.get(i.store_id) ?? null })) };
  }

  /**
   * "Sitede satın al" (K53): ürün kanalda görünür ve kaynak adresi varsa yönlendirme kaydı açılır, hedef
   * dtd_rid ile döner. Hedef istemciden alınmaz (açık yönlendirme yok).
   */
  async goto(productId: string, channel: RedirectChannel): Promise<string | null> {
    const visibleIn = channel === '3d' || channel === 'ai' || channel === 'search' ? channel : '2d';
    if (!(await this.visibility.visibleIds('product', visibleIn, [productId])).has(productId)) return null;
    const p = await this.catalog.detail(productId);
    if (!p?.source_url) return null;
    const r = await this.redirects.create({
      productId,
      storeId: p.store_id,
      sourceSiteId: p.source_site_id,
      channel,
      targetUrl: p.source_url,
    });
    return r.url;
  }

  /** Site haritası (seo kanalı, K9): yayındaki mağazalar ve ürünler. */
  async sitemap() {
    const [storeIds, productIds] = await Promise.all([this.visibility.visibleIds('store', 'seo'), this.visibility.visibleIds('product', 'seo')]);
    const [stores, products] = await Promise.all([this.commerce.publicStores([...storeIds]), this.catalog.names([...productIds])]);
    return { stores: stores.map((s) => ({ slug: s.slug })), products };
  }

  async stores(channel: Channel = '2d') {
    const storeIds = [...(await this.visibility.visibleIds('store', channel))];
    const [stores, counts] = await Promise.all([this.commerce.publicStores(storeIds), this.visibility.visibleProductCountsByStore(channel, storeIds)]);
    return stores.map((s) => ({ ...s, product_count: counts.get(s.id) ?? 0 }));
  }

  async store(slug: string, channel: Channel = '2d') {
    const store = await this.commerce.storeBySlug(slug);
    if (!store || !(await this.visibility.visibleIds('store', channel, [store.id])).has(store.id)) return null;
    const ids = await this.visibility.visibleProductIdsOfStore(store.id, channel);
    const facets = await this.catalog.facets(ids);
    const brands = await this.commerce.brands(facets.brand_ids.map((b) => b.brand_id));
    const brandCount = new Map(facets.brand_ids.map((b) => [b.brand_id, b.count]));
    return {
      ...store,
      product_count: ids.length,
      facets: {
        categories: facets.categories,
        brands: brands.map((b) => ({ ...b, count: brandCount.get(b.id) ?? 0 })),
      },
    };
  }

  async storeProducts(
    slug: string,
    q: { category?: string; brand?: string; sort: ProductSort; page: number; in_stock?: boolean },
    channel: Channel = '2d',
  ) {
    const store = await this.commerce.storeBySlug(slug);
    if (!store || !(await this.visibility.visibleIds('store', channel, [store.id])).has(store.id)) return null;
    const [ids, boosts, category, brand] = await Promise.all([
      this.visibility.visibleProductIdsOfStore(store.id, channel),
      this.visibility.boosts('product', channel),
      q.category ? this.catalog.categoryBySlug(q.category) : null,
      q.brand ? this.commerce.brandBySlug(q.brand) : null,
    ]);
    if ((q.category && !category) || (q.brand && !brand)) return { total: 0, page: q.page, page_size: PAGE_SIZE, items: [], filters: { category, brand } };
    const r = await this.catalog.list({
      productIds: ids,
      categoryId: category?.id,
      brandId: brand?.id,
      inStock: q.in_stock,
      sort: q.sort,
      offset: (q.page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      boosts,
    });
    return { total: r.total, page: q.page, page_size: PAGE_SIZE, items: r.items, filters: { category, brand } };
  }

  async product(id: string, channel: Channel = '2d') {
    if (!(await this.visibility.visibleIds('product', channel, [id])).has(id)) return null;
    const p = await this.catalog.detail(id);
    if (!p) return null;
    // Ürün görünür ama mağazası değilse (olmamalı: mağaza kuralı ürüne de uygulanır) yine gösterilmez
    if (!(await this.visibility.visibleIds('store', channel, [p.store_id])).has(p.store_id)) return null;
    const [stores, brands] = await Promise.all([
      this.commerce.publicStores([p.store_id]),
      p.brand_id ? this.commerce.brands([p.brand_id]) : Promise.resolve([]),
    ]);
    return { ...p, store: stores[0]!, brand: brands[0] ?? null };
  }
}
