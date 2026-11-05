import { Injectable } from '@nestjs/common';
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
