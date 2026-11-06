import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { resetEnvCache } from '../src/infra/config/env.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import {
  type ExportSource,
  SOURCE_CLIENT_FACTORY,
  SourceSitesService,
  SourceSyncService,
} from '../src/modules/integration/public/index.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

type Raw = Record<string, unknown> & { product_id: number; date_updated: string };
const fixture = (name: string): Raw[] =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/eticaret', name), 'utf8')).data.items;

/** Kaydedilmiş export örnekleriyle çalışan sahte kaynak: imleç, updated_since (kesin büyük) ve sayfalama kaynakla aynı. */
class FakeSource implements ExportSource {
  products: Raw[] = [];
  queries: { updatedSince?: string | null; cursor: number }[] = [];
  failWith: Error | null = null;
  async exportPage(q: { updatedSince?: string | null; cursor?: number; limit: number }) {
    const cursor = q.cursor ?? 0;
    this.queries.push({ updatedSince: q.updatedSince, cursor });
    if (this.failWith) throw this.failWith;
    const rows = this.products
      .filter((p) => p.product_id > cursor && (!q.updatedSince || p.date_updated > q.updatedSince))
      .sort((a, b) => a.product_id - b.product_id);
    const size = Math.min(q.limit, 2); // küçük sayfa: sayfalamayı da sına
    const items = rows.slice(0, size);
    return { items, nextCursor: items.at(-1)?.product_id ?? cursor, hasMore: rows.length > size };
  }
}

describe.skipIf(!hasDatabase)('kaynak eşitleme (F1.1, K41, K42)', () => {
  let db: TestDatabase;
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let sync: SourceSyncService;
  const source = new FakeSource();
  const all = [...fixture('export-page-1.json'), ...fixture('export-page-2.json')];
  const SITE = 'esensolarmarket';

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.appUrl;
    process.env.SECRETS_KEY ??= Buffer.alloc(32, 7).toString('base64');
    resetEnvCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SOURCE_CLIENT_FACTORY)
      .useValue(() => source)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    prisma = app.get(PrismaService);
    sync = app.get(SourceSyncService);
    const sites = app.get(SourceSitesService);
    await sites.register({ code: SITE, baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen Solar Market', storeName: 'Esen Solar Market' });
    await sites.setToken(SITE, 'test-token-0123456789abcdef');
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  beforeEach(() => {
    source.queries = [];
    source.failWith = null;
  });

  const events = (type: string) => prisma.outboxEvent.count({ where: { eventType: type } });

  it('tam eşitleme 4 ürünü aynaya yazar, mağazaya bağlar, olay üretir', async () => {
    source.products = structuredClone(all);
    const stats = await sync.run(SITE, 'full');
    expect(stats).toMatchObject({ pages: 2, fetched: 4, created: 4, unchanged: 0, removed: 0, invalid: 0 });
    expect(await events('catalog.product.created')).toBe(4);

    const site = await prisma.sourceSite.findUniqueOrThrow({ where: { code: SITE } });
    const store = await prisma.store.findUniqueOrThrow({ where: { slug: SITE }, include: { sources: true } });
    expect(store.sources[0]!.sourceSiteId).toBe(site.id);
    expect(site.watermark).toBe('2026-11-05 10:00:05');

    const p = await prisma.catalogProduct.findUniqueOrThrow({
      where: { sourceSiteId_externalId: { sourceSiteId: site.id, externalId: '101' } },
      include: { prices: true, stock: true, media: true, sourceCategories: true, i18n: true },
    });
    expect(p.storeId).toBe(store.id);
    expect(p.prices).toHaveLength(1);
    expect(p.prices[0]!.finalMinor).toBe(1470890n);
    expect(p.prices[0]!.validUntil?.toISOString()).toBe('2026-11-30T20:59:59.000Z');
    expect(p.stock?.status).toBe('in_stock');
    expect(p.sourceCategories).toHaveLength(2);
    expect(p.i18n[0]!.name).toBe('Ürün 101');

    const v = await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: '103' }, include: { variants: true, prices: true } });
    expect(v.variants.map((x) => x.externalRef)).toEqual(['7:48', '7:49']);
    expect(v.prices.find((x) => x.variantRef === '7:48')?.finalMinor).toBe(12050n);

    const hidden = await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: '104' }, include: { prices: true } });
    expect(hidden.prices).toHaveLength(0);
  });

  it('veritabanında alış fiyatı ya da tedarikçi sütunu yok (K41)', async () => {
    const cols = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
      WHERE table_schema IN ('catalog', 'integration', 'commerce') AND (column_name ILIKE '%buy%' OR column_name ILIKE '%supplier%')`;
    expect(cols[0]!.n).toBe(0n);
    const payloads = await prisma.outboxEvent.findMany({ select: { payload: true } });
    expect(JSON.stringify(payloads)).not.toMatch(/buy_price|777\.77|Tedarikçi/);
  });

  it('aynı veriyle ikinci tam eşitleme hiçbir şey yazmaz (idempotency)', async () => {
    const before = await prisma.outboxEvent.count();
    const stats = await sync.run(SITE, 'full');
    expect(stats).toMatchObject({ fetched: 4, created: 0, updated: 0, unchanged: 4, removed: 0 });
    expect(await prisma.outboxEvent.count()).toBe(before);
  });

  it('delta filigranın 2 dk gerisinden ister, yalnız değişeni günceller', async () => {
    const p103 = source.products.find((p) => p.product_id === 103)!;
    p103.stock = 0;
    p103.date_updated = '2026-11-05 10:30:00';
    const stats = await sync.run(SITE, 'delta');
    expect(source.queries[0]!.updatedSince).toBe('2026-11-05 09:58:05');
    // 101 örtüşme penceresinde tekrar gelir ama değişmediği için yazılmaz
    expect(stats).toMatchObject({ fetched: 2, updated: 1, unchanged: 1 });
    expect(stats.changed_fields).toEqual({ stock: 1 }); // teşhis: yalnız stok değişti
    expect(await events('catalog.product.updated')).toBe(1);
    const stock = await prisma.catalogStock.findFirstOrThrow({ where: { product: { externalId: '103' } } });
    expect(stock.status).toBe('out_of_stock');
    expect((await prisma.sourceSite.findUniqueOrThrow({ where: { code: SITE } })).watermark).toBe('2026-11-05 10:30:00');
  });

  it('indirim bitince ürün tekil yeniden çekilir; aynı bitiş için bir daha sorulmaz (K42)', async () => {
    const afterExpiry = new Date('2026-12-01T00:00:00Z');
    const p101 = source.products.find((p) => p.product_id === 101)!;
    Object.assign(p101, { price_final: 15999, price_list: 15999, price_valid_until: null }); // date_updated değişmez
    expect(await sync.refreshExpiredPrices(new Date('2026-11-20T00:00:00Z'))).toEqual({ checked: 0, changed: 0 });

    expect(await sync.refreshExpiredPrices(afterExpiry)).toEqual({ checked: 1, changed: 1 });
    expect(source.queries.at(-1)).toEqual({ updatedSince: undefined, cursor: 100 });
    const price = await prisma.catalogPrice.findFirstOrThrow({ where: { product: { externalId: '101' }, variantRef: null } });
    expect(price.finalMinor).toBe(1599900n);
    expect(price.validUntil).toBeNull();
    expect(await sync.refreshExpiredPrices(afterExpiry)).toEqual({ checked: 0, changed: 0 });
  });

  it('tam eşitlemede kaybolan ürün "kaynakta yok" olur, silinmez; geri gelince canlanır', async () => {
    source.products = source.products.filter((p) => p.product_id !== 102);
    const reconcile = await sync.run(SITE, 'full');
    expect(reconcile.removed).toBe(1);
    // Uzlaştırma sapması: delta'nın kaçırdığı fark kayda geçer
    expect(reconcile.drift_ids).toEqual(['102']);
    const gone = await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: '102' } });
    expect(gone.status).toBe('removed_at_source');
    expect(await events('catalog.product.removed')).toBe(1);

    source.products.push(structuredClone(all.find((p) => p.product_id === 102)!));
    expect((await sync.run(SITE, 'full')).updated).toBe(1);
    expect((await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: '102' } })).status).toBe('inactive');
  });

  it('boş kaynak yanıtı aynayı boşaltmaz (güvenlik sınırı)', async () => {
    const saved = source.products;
    source.products = [];
    // Küçük katalogda (10'dan az) sınır uygulanmaz; sınırı sınamak için kayıtları çoğalt
    const site = await prisma.sourceSite.findUniqueOrThrow({ where: { code: SITE } });
    await prisma.sourceRecord.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        id: crypto.randomUUID(),
        sourceSiteId: site.id,
        entity: 'product',
        externalId: `9${i}`,
        contentHash: 'x',
        sourceUpdatedAt: '2026-01-01 00:00:00',
        lastSeenAt: new Date(),
      })),
    });
    await expect(sync.run(SITE, 'full')).rejects.toThrow(/güvenlik sınırı/);
    expect(await prisma.catalogProduct.count({ where: { status: 'removed_at_source' } })).toBe(0);
    source.products = saved;
    await prisma.sourceRecord.deleteMany({ where: { externalId: { startsWith: '9' } } });
  });

  it('art arda hatalar devreyi açar; site zamanlamadan düşer; başarı sıfırlar', async () => {
    source.failWith = new Error('Kaynak HTTP 503');
    for (let i = 0; i < 3; i++) await expect(sync.run(SITE, 'delta')).rejects.toThrow('503');
    const site = await prisma.sourceSite.findUniqueOrThrow({ where: { code: SITE } });
    expect(site.consecutiveFailures).toBe(4); // önceki testteki güvenlik durdurması da sayıldı
    expect(site.circuitOpenUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await sync.dueSites()).toEqual([]);
    const failed = await prisma.syncRun.count({ where: { status: 'failed' } });
    expect(failed).toBe(4);

    source.failWith = null;
    await sync.run(SITE, 'delta');
    const ok = await prisma.sourceSite.findUniqueOrThrow({ where: { code: SITE } });
    expect(ok.consecutiveFailures).toBe(0);
    expect(ok.circuitOpenUntil).toBeNull();
  });
});
