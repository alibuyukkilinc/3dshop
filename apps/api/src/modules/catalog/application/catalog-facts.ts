import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../infra/db/types.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';

export interface ProductFacts {
  id: string;
  storeId: string;
  sourceSiteId: string;
  brandId: string | null;
  /** Platform kategorileri ve bütün ataları */
  categoryIds: string[];
  facts: {
    'product.source_status': string;
    'product.stock': number;
    'product.has_valid_price': boolean;
    'product.price_final_minor': number | null;
    'product.has_image': boolean;
    'brand.id': string | null;
    'category.ids': string[];
  };
}

export interface ProductFactsFilter {
  productIds?: string[];
  storeIds?: string[];
  sourceSiteIds?: string[];
}

/**
 * Kural motoru ve diğer okuyucular için ürün olguları (K43: olgular yalnız okuma modelinden). Fiyat kuruş,
 * yalnız kaynağın son fiyatı (K41).
 */
@Injectable()
export class CatalogFacts {
  constructor(private readonly prisma: PrismaService) {}

  async products(filter: ProductFactsFilter = {}, tx?: Tx): Promise<ProductFacts[]> {
    const db = tx ?? this.prisma;
    const rows = await db.catalogProduct.findMany({
      where: {
        ...(filter.productIds && { id: { in: filter.productIds } }),
        ...(filter.storeIds && { storeId: { in: filter.storeIds } }),
        ...(filter.sourceSiteIds && { sourceSiteId: { in: filter.sourceSiteIds } }),
      },
      select: {
        id: true,
        storeId: true,
        sourceSiteId: true,
        brandId: true,
        status: true,
        stock: { select: { quantity: true } },
        prices: { where: { variantRef: null }, select: { finalMinor: true } },
        categories: { select: { catalogCategoryId: true } },
        _count: { select: { media: true } },
      },
    });
    const parents = new Map(
      (await db.catalogCategory.findMany({ select: { id: true, parentId: true } })).map((c) => [c.id, c.parentId]),
    );
    const withAncestors = (ids: string[]) => {
      const out = new Set<string>();
      for (let id of ids) {
        for (let guard = 0; id && guard < 20 && !out.has(id); guard++) {
          out.add(id);
          id = parents.get(id) ?? '';
        }
      }
      return [...out];
    };
    return rows.map((p) => {
      const categoryIds = withAncestors(p.categories.map((c) => c.catalogCategoryId));
      const price = p.prices[0]?.finalMinor ?? null;
      return {
        id: p.id,
        storeId: p.storeId,
        sourceSiteId: p.sourceSiteId,
        brandId: p.brandId,
        categoryIds,
        facts: {
          'product.source_status': p.status,
          'product.stock': p.stock?.quantity ?? 0,
          'product.has_valid_price': price !== null && price > 0n,
          'product.price_final_minor': price === null ? null : Number(price),
          'product.has_image': p._count.media > 0,
          'brand.id': p.brandId,
          'category.ids': categoryIds,
        },
      };
    });
  }
}
