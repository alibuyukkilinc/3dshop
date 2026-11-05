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
import {
  SOURCE_CLIENT_FACTORY,
  SourceSitesService,
  SourceSyncService,
  WebhooksService,
  signWebhook,
} from '../src/modules/integration/public/index.js';
import { adminSession } from './support/admin-session.js';
import { ORIGIN } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

type Raw = Record<string, unknown> & { product_id: number };
const products: Raw[] = ['export-page-1.json', 'export-page-2.json'].flatMap(
  (f) => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/eticaret', f), 'utf8')).data.items,
);
const source = {
  async exportPage(q: { cursor?: number; limit: number }) {
    const rows = products.filter((p) => p.product_id > (q.cursor ?? 0)).sort((a, b) => a.product_id - b.product_id);
    const page = rows.slice(0, q.limit);
    return { items: page, nextCursor: page.at(-1)?.product_id ?? q.cursor ?? 0, hasMore: rows.length > q.limit };
  },
};

describe.skipIf(!hasDatabase)('webhook alıcısı (F1.4, B2)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let secret = '';
  let seq = 0;

  const post = (body: object, opts: { secret?: string; ts?: number; eventId?: string; site?: string } = {}) => {
    const raw = JSON.stringify(body);
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    return request(app.getHttpServer())
      .post(`/api/webhooks/sources/${opts.site ?? 'esensolarmarket'}`)
      .set('Content-Type', 'application/json')
      .set('X-DTD-Event-Id', opts.eventId ?? `evt-${++seq}-0000`)
      .set('X-DTD-Timestamp', ts)
      .set('X-DTD-Signature', signWebhook(opts.secret ?? secret, ts, raw))
      .send(raw);
  };

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
    await sites.register({ code: 'esensolarmarket', baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen', storeName: 'Esen' });
    await sites.setToken('esensolarmarket', 'test-token-0123456789abcdef');
    await app.get(SourceSyncService).run('esensolarmarket', 'full');

    const admin = await adminSession(app, 'admin@example.com', ['platform_admin']);
    const r = await admin.post('/admin/v1/integration/sources/esensolarmarket/webhook-secret');
    expect(r.status).toBe(201);
    secret = r.body.secret;
    expect(r.body.url_path).toBe('/api/webhooks/sources/esensolarmarket');
    // Sır listede hiç dönmez
    const list = await admin.get('/admin/v1/integration/sources');
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(list.body.items[0].webhook.has_secret).toBe(true);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('imzası doğru olay Origin olmadan kabul edilir; aynı olay ikinci kez "duplicate"', async () => {
    const body = { event: 'price.changed', site: 'esensolarmarket', product_ids: [101] };
    const a = await post(body, { eventId: 'evt-fixed-0001' });
    expect(a.status).toBe(202);
    expect(a.body).toEqual({ status: 'accepted' });
    const b = await post(body, { eventId: 'evt-fixed-0001' });
    expect(b.body).toEqual({ status: 'duplicate' });
    expect(await prisma.webhookInbox.count()).toBe(1);
  });

  it('yanlış sır, eski zaman, bilinmeyen site ve başka sitenin gövdesi reddedilir', async () => {
    const body = { event: 'stock.changed', site: 'esensolarmarket', product_ids: [103] };
    expect((await post(body, { secret: 'yanlis-sir-000000' })).status).toBe(401);
    expect((await post(body, { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    const unknown = await post({ ...body, site: 'yok' }, { site: 'yok' });
    expect(unknown.status).toBe(401);
    expect((await post({ ...body, site: 'baskasite' })).status).toBe(400);
    expect((await post({ event: 'bilinmeyen', site: 'esensolarmarket' })).status).toBe(400);
    expect(await prisma.webhookInbox.count()).toBe(1);
  });

  it('işleyici ürünü tekil yeniden çeker; silinen ürün "kaynakta yok" olur; sipariş ertelenir', async () => {
    const p101 = products.find((p) => p.product_id === 101)!;
    p101.stock = 0;
    const idx = products.findIndex((p) => p.product_id === 104);
    products.splice(idx, 1);
    await post({ event: 'product.deleted', site: 'esensolarmarket', product_ids: [104] });
    await post({ event: 'order.created', site: 'esensolarmarket', order: { order_id: 'S-1', total: 100, currency: 'TRY', dtd_rid: 'r1' } });

    expect(await app.get(WebhooksService).processPending()).toEqual({ processed: 2, failed: 0 });
    const stock = await prisma.catalogStock.findFirstOrThrow({ where: { product: { externalId: '101' } } });
    expect(stock.status).toBe('out_of_stock');
    expect((await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: '104' } })).status).toBe('removed_at_source');
    expect(await prisma.webhookInbox.count({ where: { status: 'deferred', event: 'order.created' } })).toBe(1);
    expect((await prisma.sourceSite.findFirstOrThrow()).lastWebhookAt).not.toBeNull();
  });
});
