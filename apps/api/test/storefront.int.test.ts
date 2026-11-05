import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadEnv, resetEnvCache } from '../src/infra/config/env.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { configureHttp } from '../src/infra/http/configure.js';
import { SOURCE_CLIENT_FACTORY, SourceSitesService, SourceSyncService } from '../src/modules/integration/public/index.js';
import { VisibilityService } from '../src/modules/rules/public/index.js';
import { adminSession } from './support/admin-session.js';
import { ORIGIN } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

const products = ['export-page-1.json', 'export-page-2.json'].flatMap(
  (f) => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/eticaret', f), 'utf8')).data.items as { product_id: number }[],
);
const source = {
  async exportPage(q: { cursor?: number; limit: number }) {
    const rows = products.filter((p) => p.product_id > (q.cursor ?? 0));
    const page = rows.slice(0, q.limit);
    return { items: page, nextCursor: page.at(-1)?.product_id ?? 0, hasMore: rows.length > q.limit };
  },
};

describe.skipIf(!hasDatabase)('herkese açık katalog API (F2.3)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  const get = (url: string) => request(app.getHttpServer()).get(`/api/v1${url}`);
  const pid = async (ext: string) => (await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: ext } })).id;

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
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
    configureHttp(app as NestExpressApplication, loadEnv());
    await app.init();
    prisma = app.get(PrismaService);
    const sites = app.get(SourceSitesService);
    await sites.register({ code: 'esensolarmarket', baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen Solar', storeName: 'Esen Solar Market' });
    await sites.setToken('esensolarmarket', 'test-token-0123456789abcdef');
    await app.get(SourceSyncService).run('esensolarmarket', 'full');
    await app.get(VisibilityService).recompute({ all: true });
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('taslak mağaza ve ürünleri dışarıdan görünmez', async () => {
    expect((await get('/stores')).body).toEqual({ items: [] });
    expect((await get('/stores/esensolarmarket')).status).toBe(404);
    expect((await get(`/products/${await pid('101')}`)).status).toBe(404);
  });

  it('yayındaki mağaza: liste, yüzeyler, sıralama, filtre; kaynakta pasif ürün yok', async () => {
    const store = await prisma.store.findFirstOrThrow();
    await prisma.store.update({ where: { id: store.id }, data: { status: 'active' } });
    await app.get(VisibilityService).recompute({ storeIds: [store.id] });

    // Kategori ağacı ve eşleme: İnverterler (101) → Enerji › İnverterler; marka Deye
    const admin = await adminSession(app, 'admin@example.com', ['platform_admin']);
    const root = (await admin.post('/admin/v1/catalog/categories', { name: 'Enerji', parent_id: null })).body;
    const inv = (await admin.post('/admin/v1/catalog/categories', { name: 'İnverterler', parent_id: root.id })).body;
    const sc = (await admin.get('/admin/v1/catalog/source-categories')).body.items.find((c: { name: string }) => c.name === 'İnverterler');
    await admin.put(`/admin/v1/catalog/source-categories/${sc.id}/mapping`, { catalog_category_id: inv.id });
    const brand = (await admin.post('/admin/v1/commerce/brands', { name: 'Deye' })).body;
    await admin.put('/admin/v1/catalog/brand-mappings', { source_site_id: (await prisma.sourceSite.findFirstOrThrow()).id, source_name: 'Deye', brand_id: brand.id });

    const list = await get('/stores');
    expect(list.headers['cache-control']).toBe('public, max-age=60');
    expect(list.body.items).toEqual([
      { id: store.id, slug: 'esensolarmarket', name: 'Esen Solar Market', company: { display_name: 'Esen Solar', website: 'https://esensolarmarket.com' }, product_count: 3 },
    ]);

    const s = (await get('/stores/esensolarmarket')).body;
    expect(s.facets.categories.map((c: { slug: string; count: number }) => [c.slug, c.count])).toEqual([
      ['enerji', 1],
      ['inverterler', 1],
    ]);
    expect(s.facets.brands).toEqual([{ id: brand.id, slug: 'deye', name: 'Deye', count: 2 }]);

    const byPrice = (await get('/stores/esensolarmarket/products?sort=price_desc')).body;
    expect(byPrice.total).toBe(3);
    expect(byPrice.items.map((p: { name: string }) => p.name)).toEqual(['Ürün 101', 'Ürün 103', 'Ürün 104']); // 104 fiyatsız en sonda
    expect(byPrice.items[0].price).toEqual({ final_minor: 1470890, list_minor: 1599900, currency: 'TRY', valid_until: '2026-11-30T20:59:59.000Z' });
    expect(byPrice.items.map((p: { name: string }) => p.name)).not.toContain('Ürün 102');

    expect((await get('/stores/esensolarmarket/products?category=enerji')).body.items.map((p: { name: string }) => p.name)).toEqual(['Ürün 101']);
    expect((await get('/stores/esensolarmarket/products?brand=deye&sort=name')).body.total).toBe(2);
    expect((await get('/stores/esensolarmarket/products?category=yok')).body.total).toBe(0);
    expect((await get('/stores/esensolarmarket/products?sort=kotu')).status).toBe(400);
  });

  it('ürün ayrıntısı: temizlenmiş açıklama, varyantlar, mağaza, kaynak adresi; gizli ürün 404; alış fiyatı hiçbir yanıtta yok', async () => {
    const p = (await get(`/products/${await pid('103')}`)).body;
    expect(p).toMatchObject({
      name: 'Ürün 103',
      description_html: '<p>Açıklama</p>',
      store: { slug: 'esensolarmarket' },
      source_url: 'https://esensolarmarket.com/tr/urun-103',
      in_stock: true,
    });
    expect(p.variants.map((v: { ref: string; price: { final_minor: number } }) => [v.ref, v.price.final_minor])).toEqual([
      ['7:48', 12050],
      ['7:49', 9999],
    ]);
    expect((await get(`/products/${await pid('102')}`)).status).toBe(404);

    const bodies = await Promise.all(['/stores', '/stores/esensolarmarket', '/stores/esensolarmarket/products', `/products/${await pid('101')}`].map(get));
    for (const b of bodies) expect(JSON.stringify(b.body)).not.toMatch(/buy_price|777.77|Tedarikçi|supplier/i);
  });

  it('arama (F2.4, K35): ad, açıklama kökü ve yazım hatası; gizli ürün çıkmaz', async () => {
    const names = async (q: string) => (await get(`/search?q=${encodeURIComponent(q)}`)).body.items.map((i: { name: string }) => i.name);
    expect((await names('Ürün 103'))[0]).toBe('Ürün 103'); // tam eşleşme önce; benzer adlar arkada
    expect((await names('AÇIKLAMA')).length).toBe(3); // açıklama metninde, büyük harf ve Türkçe harf farkı yok
    expect((await names('urun 101'))[0]).toBe('Ürün 101'); // katlama: ü/u farkı
    expect(await names('acik')).toHaveLength(3); // terim başı eşleşmesi
    expect((await names('Ürüm 101'))[0]).toBe('Ürün 101'); // trigram: yazım hatası
    expect(await names("x' | !")).toEqual([]); // sorgu sözdizimi sızmaz
    expect(await names('Ürün 102')).not.toContain('Ürün 102'); // kaynakta pasif
    const r = (await get('/search?q=101')).body;
    expect(r.items[0]).toMatchObject({ name: 'Ürün 101', store: { slug: 'esensolarmarket' } });
    expect((await get('/search?q=')).status).toBe(400);
  });

  it('yönlendirme (K53): kayıt açılır, kaynak adrese dtd_rid ile 302; gizli ürün 404; hedef istemciden alınmaz', async () => {
    const res = await get(`/go/${await pid('101')}?ch=2d`);
    expect(res.status).toBe(302);
    expect(res.headers['cache-control']).toBe('no-store');
    const url = new URL(res.headers.location!);
    expect(url.origin + url.pathname).toBe('https://esensolarmarket.com/tr/urun-101');
    const rid = url.searchParams.get('dtd_rid')!;
    expect(url.searchParams.get('utm_source')).toBe('dtd');
    const row = await prisma.redirect.findUniqueOrThrow({ where: { id: rid } });
    expect(row).toMatchObject({ channel: '2d', productId: await pid('101') });
    expect((await get(`/go/${await pid('102')}`)).status).toBe(404);
    expect((await get(`/go/${await pid('104')}`)).status).toBe(404); // kaynak adresi yok (hideprice örneği)
    expect((await get(`/go/${await pid('101')}?ch=2d&url=https://evil.example`)).headers.location).toContain('esensolarmarket.com');
  });

  it('site haritası (seo kanalı): yayındaki mağaza ve ürünler', async () => {
    const s = (await get('/sitemap')).body;
    expect(s.stores).toEqual([{ slug: 'esensolarmarket' }]);
    expect(s.products.map((p: { name: string }) => p.name).sort()).toEqual(['Ürün 101', 'Ürün 103', 'Ürün 104']);
  });
});
