import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';

export interface ExpiredPrice {
  productId: string;
  sourceSiteId: string;
  externalId: string;
  validUntil: Date;
}

/**
 * İndirimi bitmiş ama o andan beri kaynaktan teyit edilmemiş ürünler (K42: fiyat geçerlilik zamanlayıcısı).
 * "Teyit" = ürünün synced_at'i indirim bitişinden sonra. Kaynak indirim bitince date_updated'i değiştirmez.
 */
@Injectable()
export class CatalogPriceExpiry {
  constructor(private readonly prisma: PrismaService) {}

  async findExpired(now: Date, limit: number): Promise<ExpiredPrice[]> {
    const rows = await this.prisma.$queryRaw<{ product_id: string; source_site_id: string; external_id: string; valid_until: Date }[]>`
      SELECT p.id AS product_id, p.source_site_id, p.external_id, pr.valid_until
      FROM catalog.catalog_prices pr
      JOIN catalog.catalog_products p ON p.id = pr.product_id
      WHERE pr.variant_ref IS NULL
        AND pr.valid_until <= ${now}
        AND p.synced_at < pr.valid_until
        AND p.status <> 'removed_at_source'
      ORDER BY pr.valid_until
      LIMIT ${limit}`;
    return rows.map((r) => ({ productId: r.product_id, sourceSiteId: r.source_site_id, externalId: r.external_id, validUntil: r.valid_until }));
  }

  /** Ürün kaynaktan yeniden okundu (değişmemiş olsa da): aynı indirim bitişi için tekrar sorulmaz. */
  async markChecked(tx: Tx, productId: string, at: Date): Promise<void> {
    await tx.catalogProduct.update({ where: { id: productId }, data: { syncedAt: at } });
  }
}
