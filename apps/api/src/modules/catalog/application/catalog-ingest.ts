import { Injectable } from '@nestjs/common';
import { type Actor, type ProductV1, ProductV1Schema, uuidv7 } from '@dtd/contracts';
import { Prisma } from '../../../generated/prisma/client.js';
import type { Tx } from '../../../infra/db/types.js';
import { OutboxWriter } from '../../platform/public/index.js';
import { CatalogMappingService } from './catalog-mapping.service.js';

export interface IngestInput {
  storeId: string;
  sourceSiteId: string;
  product: ProductV1;
  /** Adaptörün hesapladığı içerik özeti; aynıysa çağıran zaten atlar */
  contentHash: string;
  actor: Actor;
  now?: Date;
}

export type IngestOutcome = 'created' | 'updated';

/**
 * Kaynaktan gelen ürünü katalog aynasına yazar (A4, K41). Çağıranın transaction'ında çalışır; olay aynı
 * transaction'da outbox'a yazılır (K34). Fiyat yalnız kaynağın son fiyatıdır, burada hesaplanmaz.
 * Platformun kendi zenginleştirmesi (ileride product_enrichments) bu yazımdan etkilenmez.
 */
@Injectable()
export class CatalogIngest {
  constructor(
    private readonly outbox: OutboxWriter,
    private readonly mapping: CatalogMappingService,
  ) {}

  async apply(tx: Tx, input: IngestInput): Promise<{ productId: string; outcome: IngestOutcome }> {
    const p = ProductV1Schema.parse(input.product);
    const now = input.now ?? new Date();
    const key = { sourceSiteId: input.sourceSiteId, externalId: p.source.external_id };
    const existing = await tx.catalogProduct.findUnique({
      where: { sourceSiteId_externalId: key },
      select: { id: true, status: true, version: true },
    });
    const productId = existing?.id ?? uuidv7(now.getTime());

    const fields = {
      storeId: input.storeId,
      brandSourceName: p.brand?.source_name ?? null,
      sku: p.identifiers.sku,
      barcode: p.identifiers.barcode,
      mpn: p.identifiers.mpn,
      modelCode: p.identifiers.model_code,
      status: p.status,
      physical: p.physical ?? Prisma.DbNull,
      sourceUrl: p.url,
      sourceUpdatedAt: p.source.updated_at,
      contentHash: input.contentHash,
      syncedAt: now,
    };

    if (existing) {
      await tx.catalogProduct.update({
        where: { id: productId },
        data: { ...fields, version: { increment: 1 } },
      });
      // Alt kayıtlar her değişiklikte baştan yazılır: kaynak doğrudur (K06), ayna onu birebir izler.
      await tx.catalogProductI18n.deleteMany({ where: { productId } });
      await tx.catalogVariant.deleteMany({ where: { productId } });
      await tx.catalogPrice.deleteMany({ where: { productId } });
      await tx.catalogMedia.deleteMany({ where: { productId } });
      await tx.productSourceCategory.deleteMany({ where: { productId } });
    } else {
      await tx.catalogProduct.create({ data: { id: productId, ...key, ...fields } });
    }

    const i18n = Object.entries(p.i18n).map(([locale, t]) => ({
      productId,
      locale,
      name: t.name,
      descriptionHtml: t.description_html,
    }));
    if (i18n.length) await tx.catalogProductI18n.createMany({ data: i18n });

    if (p.variants.length) {
      await tx.catalogVariant.createMany({
        data: p.variants.map((v, sort) => ({
          id: uuidv7(now.getTime()),
          productId,
          externalRef: v.external_ref,
          optionValues: v.options,
          sku: v.sku,
          stockQuantity: v.stock.quantity,
          sort,
        })),
      });
    }

    if (p.price) {
      const base = {
        productId,
        currency: p.price.currency,
        taxIncluded: p.price.tax_included,
        validUntil: p.price.valid_until ? new Date(p.price.valid_until) : null,
        receivedAt: now,
      };
      await tx.catalogPrice.createMany({
        data: [
          {
            id: uuidv7(now.getTime()),
            ...base,
            variantRef: null,
            finalMinor: BigInt(p.price.final_minor),
            listMinor: BigInt(p.price.list_minor),
          },
          ...p.variants
            .filter((v) => v.price)
            .map((v) => ({
              id: uuidv7(now.getTime()),
              ...base,
              variantRef: v.external_ref,
              finalMinor: BigInt(v.price!.final_minor),
              // Kaynak seçenek için ayrı liste fiyatı vermiyor; üstü çizili gösterim yalnız ürün düzeyinde
              listMinor: BigInt(v.price!.final_minor),
            })),
        ],
      });
    }

    await tx.catalogStock.upsert({
      where: { productId },
      create: { productId, ...stockRow(p.stock.quantity, now) },
      update: stockRow(p.stock.quantity, now),
    });

    if (p.media.length) {
      await tx.catalogMedia.createMany({
        data: p.media.map((m, sort) => ({
          id: uuidv7(now.getTime()),
          productId,
          kind: m.kind,
          sourceUrl: m.url,
          sort,
        })),
      });
    }

    for (const c of p.categories) {
      const cat = await tx.sourceCategory.upsert({
        where: { sourceSiteId_externalId: { sourceSiteId: input.sourceSiteId, externalId: c.external_id } },
        create: { id: uuidv7(now.getTime()), sourceSiteId: input.sourceSiteId, externalId: c.external_id, name: c.name },
        update: { name: c.name },
      });
      await tx.productSourceCategory.create({ data: { productId, sourceCategoryId: cat.id } });
    }

    // Platform kategorisi ve markası eşlemeden türetilir (F1.3): yeni ürün de mevcut eşlemeleri hemen alır
    await this.mapping.deriveCategories(tx, [productId]);
    await this.mapping.deriveBrand(tx, productId, input.sourceSiteId, p.brand?.source_name ?? null);

    const outcome: IngestOutcome = existing ? 'updated' : 'created';
    await this.outbox.append(tx, {
      type: `catalog.product.${outcome}`,
      sourceModule: 'catalog',
      aggregate: { type: 'catalog_product', id: productId },
      actor: input.actor,
      data: {
        product_id: productId,
        store_id: input.storeId,
        source_site_id: input.sourceSiteId,
        external_id: p.source.external_id,
        status: p.status,
        previous_status: existing?.status ?? null,
      },
    });
    return { productId, outcome };
  }

  /** Kaynakta artık bulunmayan ürünü işaretler; silmez (geçmiş ve eşlemeler korunur). */
  async markRemoved(tx: Tx, sourceSiteId: string, externalId: string, actor: Actor): Promise<boolean> {
    const product = await tx.catalogProduct.findUnique({
      where: { sourceSiteId_externalId: { sourceSiteId, externalId } },
      select: { id: true, storeId: true, status: true },
    });
    if (!product || product.status === 'removed_at_source') return false;
    await tx.catalogProduct.update({
      where: { id: product.id },
      data: { status: 'removed_at_source', syncedAt: new Date(), version: { increment: 1 } },
    });
    await this.outbox.append(tx, {
      type: 'catalog.product.removed',
      sourceModule: 'catalog',
      aggregate: { type: 'catalog_product', id: product.id },
      actor,
      data: { product_id: product.id, store_id: product.storeId, source_site_id: sourceSiteId, external_id: externalId },
    });
    return true;
  }
}

function stockRow(quantity: number, now: Date) {
  return { quantity, status: quantity > 0 ? 'in_stock' : 'out_of_stock', receivedAt: now };
}
