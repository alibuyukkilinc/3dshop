import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadEnv, resetEnvCache } from '../src/infra/config/env.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { configureHttp } from '../src/infra/http/configure.js';
import { SOURCE_CLIENT_FACTORY, SourceSitesService, SourceSyncService } from '../src/modules/integration/public/index.js';
import { adminSession } from './support/admin-session.js';
import { ORIGIN } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

const items = ['export-page-1.json', 'export-page-2.json'].flatMap(
  (f) => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/eticaret', f), 'utf8')).data.items as { product_id: number }[],
);
const source = {
  async exportPage(q: { cursor?: number; limit: number }) {
    const rows = items.filter((p) => p.product_id > (q.cursor ?? 0));
    return { items: rows.slice(0, q.limit), nextCursor: rows.slice(0, q.limit).at(-1)?.product_id ?? 0, hasMore: rows.length > q.limit };
  },
};

describe.skipIf(!hasDatabase)('F1.3 yönetim uçları: kaynak siteler, firma/mağaza, kategori ve marka eşleme', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof adminSession>>;
  let viewer: Awaited<ReturnType<typeof adminSession>>;
  let siteId = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.appUrl;
    process.env.APP_ORIGINS = ORIGIN;
    process.env.SECRETS_KEY ??= Buffer.alloc(32, 7).toString('base64');
    resetEnvCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SOURCE_CLIENT_FACTORY)
      .useValue(() => source)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
    configureHttp(app as NestExpressApplication, loadEnv());
    await app.init();
    prisma = app.get(PrismaService);
    siteId = (await app.get(SourceSitesService).register({
      code: 'esensolarmarket',
      baseUrl: 'https://esensolarmarket.com',
      companyDisplayName: 'Esen Solar Market',
      storeName: 'Esen Solar Market',
    })).siteId;
    admin = await adminSession(app, 'admin@example.com', ['platform_admin']);
    viewer = await adminSession(app, 'izleyici@example.com', ['approver']);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('oturumsuz istek reddedilir; salt okuyucu yazamaz', async () => {
    const { default: request } = await import('supertest');
    expect((await request(app.getHttpServer()).get('/api/admin/v1/integration/sources')).status).toBe(401);
    expect((await viewer.get('/admin/v1/integration/sources')).status).toBe(200);
    expect((await viewer.put('/admin/v1/integration/sources/esensolarmarket/token', { token: 'x'.repeat(30) })).status).toBe(403);
  });

  it('token yazılır ama hiçbir yanıtta geri dönmez; denetim kaydına yalnız "değişti" yazılır', async () => {
    const token = 'gizli-token-0123456789abcdef';
    expect((await admin.put('/admin/v1/integration/sources/esensolarmarket/token', { token })).status).toBe(204);
    const list = await admin.get('/admin/v1/integration/sources');
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.items[0]).toMatchObject({ code: 'esensolarmarket', has_token: true, health: 'stale' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'integration.source_site.token_changed' } });
    expect(JSON.stringify(audit, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(token);
  });

  it('elle eşitleme isteği worker kuyruğuna düşer; eşitleme sonrası sayılar görünür', async () => {
    const sync = app.get(SourceSyncService);
    await sync.run('esensolarmarket', 'full');
    expect(await sync.dueSites()).toEqual([]);
    expect((await admin.post('/admin/v1/integration/sources/esensolarmarket/sync', { kind: 'full' })).status).toBe(202);
    expect(await sync.dueSites()).toEqual([{ code: 'esensolarmarket', kind: 'full' }]);
    await sync.run('esensolarmarket', 'full');

    const list = await admin.get('/admin/v1/integration/sources');
    expect(list.body.items[0]).toMatchObject({ health: 'ok', catalog: { total: 4, active: 3, priced: 3, unmapped_categories: 2 } });
    const runs = await admin.get('/admin/v1/integration/sources/esensolarmarket/runs?limit=5');
    expect(runs.body.items).toHaveLength(2);

    expect((await admin.put('/admin/v1/integration/sources/esensolarmarket/status', { status: 'paused' })).status).toBe(204);
    expect((await admin.get('/admin/v1/integration/sources')).body.items[0].health).toBe('paused');
    expect(await sync.dueSites()).toEqual([]);
    await admin.put('/admin/v1/integration/sources/esensolarmarket/status', { status: 'active' });
  });

  it('firma ve mağaza düzenlenir; eski sürümle yazım çakışma verir (iyimser kilit)', async () => {
    const [company] = (await admin.get('/admin/v1/commerce/companies')).body.items;
    expect(company.stores[0].source_site_ids).toEqual([siteId]);
    const ok = await admin.patch(`/admin/v1/commerce/companies/${company.id}`, {
      version: company.version,
      legal_name: 'Esen Solar Enerji Ltd. Şti.',
      tax_number: '1234567890',
    });
    expect(ok.status).toBe(200);
    const stale = await admin.patch(`/admin/v1/commerce/companies/${company.id}`, { version: company.version, display_name: 'X Y' });
    expect(stale.status).toBe(409);
    const bad = await admin.patch(`/admin/v1/commerce/companies/${company.id}`, { version: ok.body.version, tax_number: '12' });
    expect(bad.status).toBe(400);

    const store = company.stores[0];
    const slug = await admin.patch(`/admin/v1/commerce/stores/${store.id}`, { version: store.version, slug: 'esen-solar' });
    expect(slug.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: { in: ['commerce.company.updated', 'commerce.store.updated'] } } })).toBe(2);
  });

  it('kategori ağacı: oluştur, döngü engellenir', async () => {
    const enerji = await admin.post('/admin/v1/catalog/categories', { name: 'Enerji', parent_id: null });
    expect(enerji.body.slug).toBe('enerji');
    const inv = await admin.post('/admin/v1/catalog/categories', { name: 'İnverterler', parent_id: enerji.body.id });
    expect(inv.body.slug).toBe('inverterler');
    const tree = (await admin.get('/admin/v1/catalog/categories')).body.items;
    const root = tree.find((c: { id: string }) => c.id === enerji.body.id);
    const cycle = await admin.patch(`/admin/v1/catalog/categories/${enerji.body.id}`, { version: root.version, parent_id: inv.body.id });
    expect(cycle.status).toBe(409);
    expect((await admin.post('/admin/v1/catalog/categories', { name: 'Enerji', parent_id: null })).status).toBe(409);
  });

  it('kaynak kategori eşlemesi ürünlere uygulanır; öneri ad eşleşmesinden gelir; yeni ingest de alır', async () => {
    const list = (await admin.get(`/admin/v1/catalog/source-categories?source_site_id=${siteId}&unmapped=1`)).body.items;
    const inverter = list.find((c: { name: string }) => c.name === 'İnverterler');
    const target = (await admin.get('/admin/v1/catalog/categories')).body.items.find((c: { slug: string }) => c.slug === 'inverterler');
    expect(inverter.suggestion).toBe(target.id);

    const r = await admin.put(`/admin/v1/catalog/source-categories/${inverter.id}/mapping`, { catalog_category_id: target.id });
    expect(r.body).toEqual({ affected_products: 1 });
    const pc = await prisma.productCategory.findMany({ where: { catalogCategoryId: target.id } });
    expect(pc).toHaveLength(1);
    expect(pc[0]!.isPrimary).toBe(true);

    const hibrit = list.find((c: { name: string }) => c.name === 'Hibrit İnverter');
    await admin.put(`/admin/v1/catalog/source-categories/${hibrit.id}/mapping`, { catalog_category_id: null });
    const after = (await admin.get(`/admin/v1/catalog/source-categories?source_site_id=${siteId}&unmapped=1`)).body.items;
    expect(after.map((c: { name: string }) => c.name)).not.toContain('Hibrit İnverter');

    // Eşleme ürün yeniden yazılınca kaybolmaz
    await prisma.sourceRecord.updateMany({ data: { contentHash: 'eski' } });
    await app.get(SourceSyncService).run('esensolarmarket', 'delta');
    expect(await prisma.productCategory.count({ where: { catalogCategoryId: target.id } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'catalog.category_mapping.changed' } })).toBe(2);
  });

  it('marka eşleme: marka açılır, kaynak adlar Türkçe büyük/küçük harften bağımsız eşlenir', async () => {
    const brand = await admin.post('/admin/v1/commerce/brands', { name: 'Deye' });
    expect(brand.status).toBe(201);
    expect((await admin.post('/admin/v1/commerce/brands', { name: '  DEYE ' })).status).toBe(409);

    const sources = (await admin.get('/admin/v1/catalog/source-brands')).body.items;
    const deye = sources.find((b: { source_name: string }) => b.source_name === 'Deye');
    expect(deye).toMatchObject({ products: 2, suggestion: brand.body.id });
    const r = await admin.put('/admin/v1/catalog/brand-mappings', { source_site_id: siteId, source_name: 'Deye', brand_id: brand.body.id });
    expect(r.body).toEqual({ affected_products: 2 });
    expect(await prisma.catalogProduct.count({ where: { brandId: brand.body.id } })).toBe(2);

    const ndk = sources.find((b: { source_name: string }) => b.source_name === 'Net Deneme Kulübü');
    await admin.put('/admin/v1/catalog/brand-mappings', { source_site_id: siteId, source_name: ndk.source_name, brand_id: null });
    const unmapped = (await admin.get('/admin/v1/catalog/source-brands?unmapped=1')).body.items;
    expect(unmapped).toEqual([]);
  });
});
