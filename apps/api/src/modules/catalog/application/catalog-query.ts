import { Injectable } from '@nestjs/common';
import { foldTr } from '@dtd/contracts';
import sanitizeHtml from 'sanitize-html';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';

export type ProductSort = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'name';

export interface ProductListQuery {
  /** Yalnız bu kimlikler (çağıran görünürlükle süzer, K43) */
  productIds: string[];
  categoryId?: string;
  brandId?: string;
  inStock?: boolean;
  sort: ProductSort;
  offset: number;
  limit: number;
  /** Görünürlük katsayısı (boost) ürün kimliğine göre; relevance sıralamasında kullanılır */
  boosts?: Map<string, number>;
}

export interface PublicPrice {
  final_minor: number;
  list_minor: number;
  currency: string;
  valid_until: string | null;
}

export interface ProductCard {
  id: string;
  name: string;
  store_id: string;
  brand_id: string | null;
  price: PublicPrice | null;
  in_stock: boolean;
  image: string | null;
  synced_at: string;
}

const LOCALE = 'tr';

/** Kaynak açıklaması kaynak sitenin HTML'idir: güvenli küçük bir alt kümeye indirgenir (XSS, K14 okunabilirlik). */
export function cleanDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote'],
    allowedAttributes: {},
    transformTags: { h1: 'h2', h5: 'h4', h6: 'h4' },
    exclusiveFilter: (frame) => ['p', 'li', 'strong'].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren.length,
  }).trim();
}

/**
 * Vitrin okuma modeli (catalog ProductQuery, moduller/B1). Görünürlükten habersizdir: çağıran (discovery)
 * kimlikleri rules'tan alıp verir. Fiyat kaynağın son fiyatıdır (K41), burada hesaplanmaz.
 */
@Injectable()
export class CatalogQuery {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ProductListQuery): Promise<{ total: number; items: ProductCard[] }> {
    if (q.productIds.length === 0) return { total: 0, items: [] };
    const where: Prisma.CatalogProductWhereInput = {
      id: { in: q.productIds },
      ...(q.brandId && { brandId: q.brandId }),
      ...(q.inStock && { stock: { quantity: { gt: 0 } } }),
      ...(q.categoryId && { categories: { some: { catalogCategoryId: { in: await this.descendants(q.categoryId) } } } }),
    };
    const rows = await this.prisma.catalogProduct.findMany({
      where,
      select: {
        id: true,
        storeId: true,
        brandId: true,
        syncedAt: true,
        createdAt: true,
        i18n: { where: { locale: LOCALE }, select: { name: true } },
        prices: { where: { variantRef: null } },
        stock: { select: { quantity: true } },
        media: { orderBy: { sort: 'asc' }, take: 1, select: { sourceUrl: true } },
      },
    });
    // Sıralama bellekte: pilotta mağaza başına birkaç yüz ürün; arama belgesi (F2.4) büyük listeyi üstlenir
    const cards = rows.map((r) => ({ card: toCard(r), createdAt: r.createdAt }));
    const price = (c: ProductCard) => c.price?.final_minor ?? Number.MAX_SAFE_INTEGER;
    const byName = (a: ProductCard, b: ProductCard) => a.name.localeCompare(b.name, 'tr');
    const sorted = cards.sort((a, b) => {
      switch (q.sort) {
        case 'price_asc':
          return price(a.card) - price(b.card) || byName(a.card, b.card);
        case 'price_desc':
          return (b.card.price?.final_minor ?? -1) - (a.card.price?.final_minor ?? -1) || byName(a.card, b.card);
        case 'newest':
          return b.createdAt.getTime() - a.createdAt.getTime();
        case 'name':
          return byName(a.card, b.card);
        default: {
          // Stokta olan ve görselli önce, sonra kural katsayısı, sonra ad
          const score = (c: ProductCard) => (c.in_stock ? 2 : 0) + (c.image ? 1 : 0) + (q.boosts?.get(c.id) ?? 1);
          return score(b.card) - score(a.card) || byName(a.card, b.card);
        }
      }
    });
    return { total: sorted.length, items: sorted.slice(q.offset, q.offset + q.limit).map((x) => x.card) };
  }

  /** Mağaza sayfası yüzeyleri: görünen ürünlerin platform kategorileri (atalarıyla) ve markaları, sayılarıyla. */
  async facets(productIds: string[]) {
    if (productIds.length === 0) return { categories: [], brand_ids: [] as { brand_id: string; count: number }[] };
    const [links, brands, cats] = await Promise.all([
      this.prisma.productCategory.findMany({ where: { productId: { in: productIds } }, select: { productId: true, catalogCategoryId: true } }),
      this.prisma.catalogProduct.groupBy({ by: ['brandId'], where: { id: { in: productIds }, brandId: { not: null } }, _count: { _all: true } }),
      this.prisma.catalogCategory.findMany({ where: { status: 'active' }, include: { i18n: { where: { locale: LOCALE } } } }),
    ]);
    const parent = new Map(cats.map((c) => [c.id, c.parentId]));
    const perCategory = new Map<string, Set<string>>();
    for (const l of links) {
      for (let id: string | null | undefined = l.catalogCategoryId, g = 0; id && g < 20; id = parent.get(id), g++) {
        if (!perCategory.has(id)) perCategory.set(id, new Set());
        perCategory.get(id)!.add(l.productId);
      }
    }
    return {
      categories: cats
        .filter((c) => perCategory.has(c.id))
        .map((c) => ({
          id: c.id,
          parent_id: c.parentId,
          slug: c.slug,
          name: c.i18n[0]?.name ?? c.slug,
          sort: c.sort,
          count: perCategory.get(c.id)!.size,
        })),
      brand_ids: brands.map((b) => ({ brand_id: b.brandId!, count: b._count._all })),
    };
  }

  /**
   * 3D iç mekân koridorları (K64): her ürüne tek bir grup etiketi. Önce platform birincil kategorisinin kökü
   * (eşleme yapılmışsa), yoksa ürünün kaynak kategorilerinden bu ürün kümesinde en kalabalık olanı (büyük
   * gruplar oluşsun, ürün tek koridorda dursun). Hiçbiri yoksa null.
   */
  async groupLabels(productIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (productIds.length === 0) return out;
    const [primary, cats, sources] = await Promise.all([
      this.prisma.productCategory.findMany({ where: { productId: { in: productIds }, isPrimary: true }, select: { productId: true, catalogCategoryId: true } }),
      this.prisma.catalogCategory.findMany({ where: { status: 'active' }, include: { i18n: { where: { locale: LOCALE } } } }),
      this.prisma.productSourceCategory.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, sourceCategory: { select: { id: true, name: true } } },
      }),
    ]);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const root = (id: string) => {
      let c = byId.get(id);
      for (let g = 0; c?.parentId && byId.has(c.parentId) && g < 20; g++) c = byId.get(c.parentId);
      return c ? (c.i18n[0]?.name ?? c.slug) : null;
    };
    for (const p of primary) {
      const name = root(p.catalogCategoryId);
      if (name) out.set(p.productId, name);
    }
    const size = new Map<string, number>();
    for (const s of sources) size.set(s.sourceCategory.id, (size.get(s.sourceCategory.id) ?? 0) + 1);
    const best = new Map<string, { id: string; name: string }>();
    for (const s of sources) {
      if (out.has(s.productId)) continue;
      const cur = best.get(s.productId);
      if (!cur || size.get(s.sourceCategory.id)! > size.get(cur.id)!) best.set(s.productId, s.sourceCategory);
    }
    for (const [pid, c] of best) out.set(pid, c.name.trim());
    return out;
  }

  async categoryBySlug(slug: string) {
    const c = await this.prisma.catalogCategory.findUnique({ where: { slug }, include: { i18n: { where: { locale: LOCALE } } } });
    return c && c.status === 'active' ? { id: c.id, slug: c.slug, name: c.i18n[0]?.name ?? c.slug } : null;
  }

  async detail(id: string) {
    const p = await this.prisma.catalogProduct.findUnique({
      where: { id },
      include: {
        i18n: { where: { locale: LOCALE } },
        prices: true,
        stock: true,
        media: { orderBy: { sort: 'asc' } },
        variants: { orderBy: { sort: 'asc' } },
        categories: { include: { catalogCategory: { include: { i18n: { where: { locale: LOCALE } } } } } },
      },
    });
    if (!p) return null;
    const base = p.prices.find((x) => x.variantRef === null);
    const primary = p.categories.find((c) => c.isPrimary)?.catalogCategory ?? p.categories[0]?.catalogCategory ?? null;
    return {
      id: p.id,
      store_id: p.storeId,
      source_site_id: p.sourceSiteId,
      brand_id: p.brandId,
      name: p.i18n[0]?.name ?? `#${p.externalId}`,
      description_html: cleanDescription(p.i18n[0]?.descriptionHtml ?? ''),
      sku: p.sku,
      barcode: p.barcode,
      mpn: p.mpn,
      price: base ? toPrice(base) : null,
      in_stock: (p.stock?.quantity ?? 0) > 0,
      images: p.media.filter((m) => m.kind === 'image').map((m) => m.sourceUrl),
      variants: p.variants.map((v) => {
        const vp = p.prices.find((x) => x.variantRef === v.externalRef);
        return {
          ref: v.externalRef,
          options: v.optionValues as { group: string; value: string }[],
          price: vp ? toPrice(vp) : null,
          in_stock: v.stockQuantity > 0,
        };
      }),
      primary_category: primary ? { id: primary.id, slug: primary.slug, name: primary.i18n[0]?.name ?? primary.slug, parent_id: primary.parentId } : null,
      source_url: p.sourceUrl,
      synced_at: p.syncedAt.toISOString(),
    };
  }

  /**
   * Arama (K35). Ad ve açıklama Türkçe katlanır (catalog.fold_tr, yerel ayardan bağımsız); her kelime terim
   * başı olarak eşleşir ("inverter" → "inverterler"), ad üzerinde trigram yazım hatasını tolere eder.
   * Yalnız verilen kimlikler arasında (çağıran search kanalında görünenleri verir). Ad eşleşmesi önce gelir.
   */
  async search(q: string, productIds: string[], offset: number, limit: number): Promise<{ total: number; items: ProductCard[] }> {
    const folded = foldTr(q.trim().slice(0, 100));
    // tsquery yalnız [a-z0-9] kelimelerden kurulur: kullanıcı girdisi sorgu sözdizimine sızamaz
    const words = folded.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
    if (words.length === 0 || productIds.length === 0) return { total: 0, items: [] };
    const tsq = words.map((w) => `${w}:*`).join(' & ');
    const phrase = words.join(' ');
    const like = `%${phrase}%`;
    const rows = await this.prisma.$queryRaw<{ id: string; score: number }[]>`
      SELECT i.product_id AS id,
             (CASE WHEN catalog.fold_tr(i.name) LIKE ${like} THEN 2 ELSE 0 END)
             + ts_rank(to_tsvector('simple', catalog.fold_tr(i.name || ' ' || i.description_html)), to_tsquery('simple', ${tsq}))
             + similarity(catalog.fold_tr(i.name), ${phrase}) AS score
      FROM catalog.catalog_products_i18n i
      WHERE i.locale = 'tr'
        AND i.product_id = ANY(${productIds}::uuid[])
        AND (
          to_tsvector('simple', catalog.fold_tr(i.name || ' ' || i.description_html)) @@ to_tsquery('simple', ${tsq})
          OR similarity(catalog.fold_tr(i.name), ${phrase}) > 0.3
        )
      ORDER BY score DESC, i.name
      LIMIT 500`;
    const page = rows.slice(offset, offset + limit).map((r) => r.id);
    if (page.length === 0) return { total: rows.length, items: [] };
    const cards = await this.list({ productIds: page, sort: 'name', offset: 0, limit: page.length });
    const byId = new Map(cards.items.map((c) => [c.id, c]));
    return { total: rows.length, items: page.map((id) => byId.get(id)).filter((c): c is ProductCard => Boolean(c)) };
  }

  /** Site haritası: ad ve son eşitleme zamanı. */
  async names(productIds: string[]): Promise<{ id: string; name: string; updated_at: string }[]> {
    if (productIds.length === 0) return [];
    const rows = await this.prisma.catalogProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, syncedAt: true, i18n: { where: { locale: LOCALE }, select: { name: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.i18n[0]?.name ?? '', updated_at: r.syncedAt.toISOString() }));
  }

  /** Kategori ve tüm alt kategorileri. */
  private async descendants(rootId: string): Promise<string[]> {
    const all = await this.prisma.catalogCategory.findMany({ where: { status: 'active' }, select: { id: true, parentId: true } });
    const out = [rootId];
    for (let i = 0; i < out.length; i++) for (const c of all) if (c.parentId === out[i]) out.push(c.id);
    return out;
  }
}

function toPrice(p: { finalMinor: bigint; listMinor: bigint; currency: string; validUntil: Date | null }): PublicPrice {
  return {
    final_minor: Number(p.finalMinor),
    list_minor: Number(p.listMinor),
    currency: p.currency.trim(),
    valid_until: p.validUntil?.toISOString() ?? null,
  };
}

function toCard(r: {
  id: string;
  storeId: string;
  brandId: string | null;
  syncedAt: Date;
  i18n: { name: string }[];
  prices: { finalMinor: bigint; listMinor: bigint; currency: string; validUntil: Date | null }[];
  stock: { quantity: number } | null;
  media: { sourceUrl: string }[];
}): ProductCard {
  return {
    id: r.id,
    name: r.i18n[0]?.name ?? '',
    store_id: r.storeId,
    brand_id: r.brandId,
    price: r.prices[0] ? toPrice(r.prices[0]) : null,
    in_stock: (r.stock?.quantity ?? 0) > 0,
    image: r.media[0]?.sourceUrl ?? null,
    synced_at: r.syncedAt.toISOString(),
  };
}
