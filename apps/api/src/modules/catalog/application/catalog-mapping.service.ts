import { Injectable } from '@nestjs/common';
import { SLUG_RE, normalizeKey, slugify, uuidv7 } from '@dtd/contracts';
import { type AdminContext, conflict, notFound } from '../../../infra/http/admin-request.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';
import { AuditWriter } from '../../audit/public/index.js';
import { CommerceAdminService } from '../../commerce/public/index.js';
import { OutboxWriter } from '../../platform/public/index.js';

export type MappingTarget = { kind: 'category'; id: string } | { kind: 'brand'; id: string } | { kind: 'ignore' };

const LOCALE = 'tr';

/**
 * Platform kategori ağacı ve kaynak → platform eşlemeleri (A4, F1.3). Ürünün platform kategorisi ve markası
 * eşlemeden türetilir (product_categories, catalog_products.brand_id); eşleme değişince etkilenen ürünler
 * aynı transaction'da yeniden türetilir ve olay yazılır (K34). Eşitleme bu türetmeyi ezmez, her ingest'te
 * yeniden uygular.
 */
@Injectable()
export class CatalogMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly commerce: CommerceAdminService,
  ) {}

  // ---------------------------------------------------------------- Kategori ağacı

  async categoryTree() {
    const [rows, counts] = await Promise.all([
      this.prisma.catalogCategory.findMany({ orderBy: [{ sort: 'asc' }, { slug: 'asc' }], include: { i18n: true } }),
      this.prisma.productCategory.groupBy({ by: ['catalogCategoryId'], _count: { _all: true } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.catalogCategoryId, c._count._all]));
    return rows.map((c) => ({
      id: c.id,
      parent_id: c.parentId,
      slug: c.slug,
      name: c.i18n.find((t) => t.locale === LOCALE)?.name ?? c.slug,
      sort: c.sort,
      status: c.status,
      version: c.version,
      product_count: countBy.get(c.id) ?? 0,
    }));
  }

  async createCategory(input: { name: string; parent_id: string | null; slug?: string; sort?: number }, ctx: AdminContext) {
    const name = clean(input.name);
    const slug = input.slug ?? slugify(name);
    if (!SLUG_RE.test(slug)) throw conflict('Adres yalnız küçük harf, rakam ve tire içerebilir.');
    return this.prisma.$transaction(async (tx) => {
      if (input.parent_id && !(await tx.catalogCategory.findUnique({ where: { id: input.parent_id } }))) {
        throw notFound('Üst kategori bulunamadı.');
      }
      if (await tx.catalogCategory.findUnique({ where: { slug } })) throw conflict('Bu adres başka bir kategoride kullanılıyor.');
      const id = uuidv7();
      await tx.catalogCategory.create({
        data: { id, parentId: input.parent_id, slug, sort: input.sort ?? 0, i18n: { create: { locale: LOCALE, name } } },
      });
      await this.record(tx, ctx, 'catalog.category.created', { type: 'catalog_category', id }, { name, slug, parent_id: input.parent_id });
      return { id, slug };
    });
  }

  async updateCategory(
    id: string,
    patch: { version: number; name?: string; parent_id?: string | null; sort?: number; status?: 'active' | 'archived' },
    ctx: AdminContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.catalogCategory.findUnique({ where: { id }, include: { i18n: true } });
      if (!before) throw notFound('Kategori bulunamadı.');
      if (patch.parent_id !== undefined && patch.parent_id !== before.parentId && patch.parent_id !== null) {
        await this.assertNoCycle(tx, id, patch.parent_id);
      }
      if (patch.status === 'archived') {
        const used = await tx.categoryMapping.count({ where: { catalogCategoryId: id } });
        const kids = await tx.catalogCategory.count({ where: { parentId: id, status: 'active' } });
        if (used || kids) throw conflict('Eşlemesi ya da aktif alt kategorisi olan kategori arşivlenemez.');
      }
      const r = await tx.catalogCategory.updateMany({
        where: { id, version: patch.version },
        data: {
          ...(patch.parent_id !== undefined && { parentId: patch.parent_id }),
          ...(patch.sort !== undefined && { sort: patch.sort }),
          ...(patch.status !== undefined && { status: patch.status }),
          version: { increment: 1 },
        },
      });
      if (r.count === 0) throw conflict('Kategori siz düzenlerken değişti. Sayfayı yenileyin.');
      if (patch.name !== undefined) {
        await tx.catalogCategoryI18n.upsert({
          where: { categoryId_locale: { categoryId: id, locale: LOCALE } },
          create: { categoryId: id, locale: LOCALE, name: clean(patch.name) },
          update: { name: clean(patch.name) },
        });
      }
      await this.record(tx, ctx, 'catalog.category.updated', { type: 'catalog_category', id }, {
        ...patch,
        previous: { parent_id: before.parentId, name: before.i18n[0]?.name ?? null, status: before.status },
      });
      return { id, version: patch.version + 1 };
    });
  }

  private async assertNoCycle(tx: Tx, id: string, newParentId: string) {
    if (newParentId === id) throw conflict('Kategori kendi altına taşınamaz.');
    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id FROM catalog.catalog_categories WHERE id = ${newParentId}::uuid
        UNION ALL
        SELECT c.id, c.parent_id FROM catalog.catalog_categories c JOIN up ON c.id = up.parent_id
      )
      SELECT id FROM up WHERE id = ${id}::uuid LIMIT 1`;
    if (rows.length) throw conflict('Kategori kendi alt kategorisinin altına taşınamaz.');
  }

  // ---------------------------------------------------------------- Kategori eşleme

  /** Kaynak kategoriler, ürün sayıları, mevcut eşleme ve ad eşleşmesinden öneri. */
  async sourceCategories(filter: { source_site_id?: string; unmapped?: boolean }) {
    const [rows, tree] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string; source_site_id: string; name: string; products: bigint; active_products: bigint }[]
      >`
        SELECT sc.id, sc.source_site_id, sc.name,
               count(p.id) AS products,
               count(p.id) FILTER (WHERE p.status = 'active') AS active_products
        FROM catalog.source_categories sc
        LEFT JOIN catalog.product_source_categories psc ON psc.source_category_id = sc.id
        LEFT JOIN catalog.catalog_products p ON p.id = psc.product_id
        GROUP BY sc.id
        ORDER BY active_products DESC, sc.name`,
      this.categoryTree(),
    ]);
    const mappings = new Map((await this.prisma.categoryMapping.findMany()).map((m) => [m.sourceCategoryId, m]));
    const byName = new Map(tree.filter((c) => c.status === 'active').map((c) => [normalizeKey(c.name), c.id]));
    return rows
      .filter((r) => !filter.source_site_id || r.source_site_id === filter.source_site_id)
      .map((r) => {
        const m = mappings.get(r.id);
        return {
          id: r.id,
          source_site_id: r.source_site_id,
          name: r.name,
          products: Number(r.products),
          active_products: Number(r.active_products),
          mapping: m ? { catalog_category_id: m.catalogCategoryId, ignored: m.ignored, method: m.method } : null,
          suggestion: m ? null : (byName.get(normalizeKey(r.name)) ?? null),
        };
      })
      .filter((r) => !filter.unmapped || r.mapping === null);
  }

  async mapSourceCategory(sourceCategoryId: string, target: { catalog_category_id: string | null }, ctx: AdminContext) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.sourceCategory.findUnique({ where: { id: sourceCategoryId } });
      if (!source) throw notFound('Kaynak kategori bulunamadı.');
      const targetId = target.catalog_category_id;
      if (targetId) {
        const cat = await tx.catalogCategory.findUnique({ where: { id: targetId } });
        if (!cat || cat.status !== 'active') throw notFound('Platform kategorisi bulunamadı.');
      }
      const data = { catalogCategoryId: targetId, ignored: targetId === null, method: 'manual', approvedBy: ctx.actor.id };
      await tx.categoryMapping.upsert({ where: { sourceCategoryId }, create: { sourceCategoryId, ...data }, update: data });
      const products = await tx.productSourceCategory.findMany({ where: { sourceCategoryId }, select: { productId: true } });
      await this.deriveCategories(tx, products.map((p) => p.productId));
      await this.record(tx, ctx, 'catalog.category_mapping.changed', { type: 'source_category', id: sourceCategoryId }, {
        source_site_id: source.sourceSiteId,
        source_name: source.name,
        catalog_category_id: targetId,
        affected_products: products.length,
      });
      return { affected_products: products.length };
    });
  }

  // ---------------------------------------------------------------- Marka eşleme

  /** Kaynaklardaki farklı üretici adları (site başına), ürün sayıları, eşleme ve öneri. */
  async sourceBrands(filter: { source_site_id?: string; unmapped?: boolean }) {
    const [raw, mappings, brands] = await Promise.all([
      this.prisma.$queryRaw<{ source_site_id: string; source_name: string; products: bigint; active_products: bigint }[]>`
        SELECT source_site_id, brand_source_name AS source_name,
               count(*) AS products, count(*) FILTER (WHERE status = 'active') AS active_products
        FROM catalog.catalog_products
        WHERE brand_source_name IS NOT NULL
        GROUP BY source_site_id, brand_source_name`,
      this.prisma.brandMapping.findMany(),
      this.commerce.brands(),
    ]);
    // Gruplama JS'de: PostgreSQL lower() Türkçe İ/I'yı toLocaleLowerCase('tr') gibi çevirmez
    const grouped = new Map<string, { source_site_id: string; source_name: string; products: number; active_products: number }>();
    for (const r of raw) {
      const k = `${r.source_site_id}|${normalizeKey(r.source_name)}`;
      const g = grouped.get(k) ?? { source_site_id: r.source_site_id, source_name: r.source_name.trim(), products: 0, active_products: 0 };
      g.products += Number(r.products);
      g.active_products += Number(r.active_products);
      grouped.set(k, g);
    }
    const rows = [...grouped.values()].sort(
      (a, b) => b.active_products - a.active_products || a.source_name.localeCompare(b.source_name, 'tr'),
    );
    const mapBy = new Map(mappings.map((m) => [`${m.sourceSiteId}|${m.sourceKey}`, m]));
    const brandByKey = new Map(brands.filter((b) => b.status === 'active').map((b) => [normalizeKey(b.name), b.id]));
    return rows
      .filter((r) => !filter.source_site_id || r.source_site_id === filter.source_site_id)
      .map((r) => {
        const key = normalizeKey(r.source_name);
        const m = mapBy.get(`${r.source_site_id}|${key}`);
        return {
          source_site_id: r.source_site_id,
          source_name: r.source_name,
          source_key: key,
          products: r.products,
          active_products: r.active_products,
          mapping: m ? { brand_id: m.brandId, ignored: m.ignored, method: m.method } : null,
          suggestion: m ? null : (brandByKey.get(key) ?? null),
        };
      })
      .filter((r) => !filter.unmapped || r.mapping === null);
  }

  async mapSourceBrand(
    input: { source_site_id: string; source_name: string; brand_id: string | null },
    ctx: AdminContext,
  ) {
    const key = normalizeKey(input.source_name);
    if (input.brand_id && !(await this.commerce.brandExists(input.brand_id))) throw notFound('Marka bulunamadı.');
    return this.prisma.$transaction(async (tx) => {
      const data = { brandId: input.brand_id, ignored: input.brand_id === null, method: 'manual', approvedBy: ctx.actor.id };
      await tx.brandMapping.upsert({
        where: { sourceSiteId_sourceKey: { sourceSiteId: input.source_site_id, sourceKey: key } },
        create: { id: uuidv7(), sourceSiteId: input.source_site_id, sourceKey: key, sourceName: input.source_name.trim(), ...data },
        update: data,
      });
      const affected = await this.applyBrandMapping(tx, input.source_site_id, key, input.brand_id);
      await this.record(tx, ctx, 'catalog.brand_mapping.changed', { type: 'brand_mapping', id: `${input.source_site_id}:${key}` }, {
        source_site_id: input.source_site_id,
        source_name: input.source_name,
        brand_id: input.brand_id,
        affected_products: affected,
      });
      return { affected_products: affected };
    });
  }

  // ---------------------------------------------------------------- Ürün arama (yönetim)

  /** Yönetim için ürün bulma: ad, SKU ya da kaynak kimliği. Görünürlükten bağımsız (yönetici her şeyi görür). */
  async searchProducts(q: string, limit: number) {
    const term = q.trim();
    const rows = await this.prisma.catalogProduct.findMany({
      where: term
        ? {
            OR: [
              { externalId: term },
              { sku: { contains: term, mode: 'insensitive' } },
              { i18n: { some: { name: { contains: term, mode: 'insensitive' } } } },
            ],
          }
        : {},
      orderBy: { syncedAt: 'desc' },
      take: limit,
      select: { id: true, externalId: true, sku: true, status: true, storeId: true, sourceSiteId: true, i18n: { where: { locale: 'tr' }, select: { name: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      external_id: p.externalId,
      sku: p.sku,
      status: p.status,
      store_id: p.storeId,
      source_site_id: p.sourceSiteId,
      name: p.i18n[0]?.name ?? `#${p.externalId}`,
    }));
  }

  // ---------------------------------------------------------------- İzleme

  /** Kaynak site başına ayna sayıları (eşitleme izleme ekranı). */
  async siteCounts(): Promise<Record<string, { total: number; active: number; priced: number; unmapped_categories: number }>> {
    const rows = await this.prisma.$queryRaw<{ source_site_id: string; total: bigint; active: bigint; priced: bigint }[]>`
      SELECT p.source_site_id, count(*) AS total,
             count(*) FILTER (WHERE p.status = 'active') AS active,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM catalog.catalog_prices pr WHERE pr.product_id = p.id AND pr.variant_ref IS NULL)) AS priced
      FROM catalog.catalog_products p GROUP BY p.source_site_id`;
    const unmapped = await this.prisma.$queryRaw<{ source_site_id: string; n: bigint }[]>`
      SELECT sc.source_site_id, count(*) AS n FROM catalog.source_categories sc
      LEFT JOIN catalog.category_mappings cm ON cm.source_category_id = sc.id
      WHERE cm.source_category_id IS NULL GROUP BY sc.source_site_id`;
    const u = new Map(unmapped.map((r) => [r.source_site_id, Number(r.n)]));
    return Object.fromEntries(
      rows.map((r) => [
        r.source_site_id,
        { total: Number(r.total), active: Number(r.active), priced: Number(r.priced), unmapped_categories: u.get(r.source_site_id) ?? 0 },
      ]),
    );
  }

  // ---------------------------------------------------------------- Türetme (ingest de kullanır)

  /** Ürünlerin platform kategorilerini eşlemelerden yeniden kurar. Birincil: en derindeki, eşitlikte en küçük sort. */
  async deriveCategories(tx: Tx, productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    await tx.productCategory.deleteMany({ where: { productId: { in: productIds } } });
    await tx.$executeRaw`
      WITH RECURSIVE depth AS (
        SELECT id, 0 AS d FROM catalog.catalog_categories WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, depth.d + 1 FROM catalog.catalog_categories c JOIN depth ON c.parent_id = depth.id
      ),
      targets AS (
        SELECT DISTINCT psc.product_id, cm.catalog_category_id, depth.d, cc.sort
        FROM catalog.product_source_categories psc
        JOIN catalog.category_mappings cm ON cm.source_category_id = psc.source_category_id AND NOT cm.ignored
        JOIN catalog.catalog_categories cc ON cc.id = cm.catalog_category_id AND cc.status = 'active'
        JOIN depth ON depth.id = cc.id
        WHERE psc.product_id = ANY(${productIds}::uuid[])
      ),
      ranked AS (
        SELECT *, row_number() OVER (PARTITION BY product_id ORDER BY d DESC, sort, catalog_category_id) AS rn FROM targets
      )
      INSERT INTO catalog.product_categories (product_id, catalog_category_id, is_primary)
      SELECT product_id, catalog_category_id, rn = 1 FROM ranked`;
  }

  /** Tek ürünün markasını eşlemeden türetir (ingest). */
  async deriveBrand(tx: Tx, productId: string, sourceSiteId: string, brandSourceName: string | null): Promise<void> {
    let brandId: string | null = null;
    if (brandSourceName) {
      const m = await tx.brandMapping.findUnique({
        where: { sourceSiteId_sourceKey: { sourceSiteId, sourceKey: normalizeKey(brandSourceName) } },
      });
      brandId = m?.brandId ?? null;
    }
    await tx.catalogProduct.update({ where: { id: productId }, data: { brandId } });
  }

  private async applyBrandMapping(tx: Tx, sourceSiteId: string, key: string, brandId: string | null): Promise<number> {
    const candidates = await tx.catalogProduct.findMany({
      where: { sourceSiteId, brandSourceName: { not: null } },
      select: { id: true, brandSourceName: true },
    });
    const ids = candidates.filter((p) => normalizeKey(p.brandSourceName!) === key).map((p) => p.id);
    if (ids.length) await tx.catalogProduct.updateMany({ where: { id: { in: ids } }, data: { brandId } });
    return ids.length;
  }

  private async record(tx: Tx, ctx: AdminContext, action: string, entity: { type: string; id: string }, data: Record<string, unknown>) {
    await this.audit.write(tx, { actor: ctx.actor, action, entity, diff: data, requestId: ctx.requestId, ipHash: ctx.ipHash });
    await this.outbox.append(tx, {
      type: action,
      sourceModule: 'catalog',
      aggregate: entity,
      actor: ctx.actor,
      data: { ...data, [`${entity.type}_id`]: entity.id },
    });
  }
}

function clean(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}
