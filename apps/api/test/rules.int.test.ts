import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { uuidv7 } from '@dtd/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadEnv, resetEnvCache } from '../src/infra/config/env.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { configureHttp } from '../src/infra/http/configure.js';
import { SOURCE_CLIENT_FACTORY, SourceSitesService, SourceSyncService } from '../src/modules/integration/public/index.js';
import { OutboxRelay } from '../src/modules/platform/public/index.js';
import { CHANNELS, VisibilityEventHandler, VisibilityService } from '../src/modules/rules/public/index.js';
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

describe.skipIf(!hasDatabase)('kural motoru (F2.1, K43, K8)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let visibility: VisibilityService;
  let storeId = '';
  const pid = async (ext: string) => (await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: ext } })).id;
  const vis = async (ext: string, channel: string) =>
    (await prisma.visibilityResolved.findUniqueOrThrow({
      where: { targetType_targetId_channel: { targetType: 'product', targetId: await pid(ext), channel } },
    })).visible;

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
    visibility = app.get(VisibilityService);
    const sites = app.get(SourceSitesService);
    await sites.register({ code: 'esensolarmarket', baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen', storeName: 'Esen' });
    await sites.setToken('esensolarmarket', 'test-token-0123456789abcdef');
    await app.get(SourceSyncService).run('esensolarmarket', 'full');
    storeId = (await prisma.store.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('taslak mağaza ve ürünleri hiçbir kanalda görünmez', async () => {
    const r = await visibility.recompute({ all: true });
    expect(r.targets).toBe(5); // 1 mağaza + 4 ürün
    expect(await prisma.visibilityResolved.count()).toBe(5 * CHANNELS.length);
    expect(await prisma.visibilityResolved.count({ where: { visible: true } })).toBe(0);
    const row = await prisma.visibilityResolved.findFirstOrThrow({ where: { targetType: 'store' } });
    expect((row.explanation as { decided_by: string }).decided_by).toBe('SYS_STORE_NOT_PUBLISHED');
  });

  it('mağaza yayına girince: aktif ürün görünür, kaynakta pasif gizli, stoksuz ürün 3D dışında görünür', async () => {
    await prisma.store.update({ where: { id: storeId }, data: { status: 'active' } });
    await visibility.recompute({ storeIds: [storeId] });
    expect(await vis('101', '2d')).toBe(true);
    expect(await vis('102', '2d')).toBe(false); // supplier_status=0 → inactive
    const p103 = await pid('103');
    await prisma.catalogStock.update({ where: { productId: p103 }, data: { quantity: 0, status: 'out_of_stock' } });
    await visibility.recompute({ productIds: [p103] });
    expect(await vis('103', '3d')).toBe(false);
    expect(await vis('103', '2d')).toBe(true);
  });

  it('aynı girdiyle yeniden hesap olay üretmez (idempotent); değişiklik rules.visibility.changed yayar', async () => {
    const before = await prisma.outboxEvent.count({ where: { eventType: 'rules.visibility.changed' } });
    expect((await visibility.recompute({ all: true })).changed).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'rules.visibility.changed' } })).toBe(before);
  });

  it('K8: hukuki engel her kanalda gizler; istisna, öncelik ve yönetici onu aşamaz; dayanaksız/ezilmesi engellenir', async () => {
    const p101 = await pid('101');
    const legalId = uuidv7();
    await prisma.rule.create({
      data: {
        id: legalId,
        code: 'LEGAL_TEST',
        name: 'Mahkeme kararı',
        layer: 'mandatory_block',
        effect: 'deny',
        legalRef: 'İstanbul 3. Asliye Ticaret 2026/123',
        status: 'active',
        targets: { create: { id: uuidv7(), targetType: 'product', targetId: p101 } },
      },
    });
    await prisma.rule.create({
      data: {
        id: uuidv7(),
        code: 'EXC_TEST',
        name: 'İstisna',
        layer: 'exception',
        effect: 'allow',
        priority: 1_000_000,
        status: 'active',
        targets: { create: { id: uuidv7(), targetType: 'product', targetId: p101 } },
      },
    });
    await visibility.recompute({ productIds: [p101] });
    for (const ch of CHANNELS) expect(await vis('101', ch)).toBe(false);

    await expect(
      prisma.rule.create({ data: { id: uuidv7(), code: 'NO_REF', name: 'x', layer: 'mandatory_block', effect: 'deny', status: 'active' } }),
    ).rejects.toThrow();
    await expect(
      prisma.rule.create({
        data: { id: uuidv7(), code: 'OVR', name: 'x', layer: 'exception', effect: 'allow', overridesRuleId: legalId, status: 'active' },
      }),
    ).rejects.toThrow(/ezilemez/);
    await expect(prisma.rule.delete({ where: { id: legalId } })).rejects.toThrow(/silinemez/);
  });

  it('açıklama ucu karar veren kuralı, dayanağı ve adımları gösterir', async () => {
    const admin = await adminSession(app, 'admin@example.com', ['platform_admin']);
    const r = await admin.get(`/admin/v1/rules/explain?target_type=product&target_id=${await pid('101')}&channel=2d`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      visible: false,
      layer: 'mandatory_block',
      decided_by: { code: 'LEGAL_TEST', legal_ref: 'İstanbul 3. Asliye Ticaret 2026/123' },
      in_sync: true,
    });
    expect(r.body.steps.map((s: { rule: string }) => s.rule)).toContain('EXC_TEST');
    const list = await admin.get('/admin/v1/rules');
    expect(list.body.items.filter((x: { system: boolean }) => x.system)).toHaveLength(4);
  });

  it('olay tüketicisi: kaynakta ürün pasifleşince görünürlük artımlı güncellenir', async () => {
    const relay = app.get(OutboxRelay);
    relay.register(app.get(VisibilityEventHandler));
    while ((await relay.runOnce()) > 0);
    expect(await vis('104', '2d')).toBe(true);
    const p = products.find((x) => x.product_id === 104)!;
    p.status = 0;
    await app.get(SourceSyncService).run('esensolarmarket', 'full');
    while ((await relay.runOnce()) > 0);
    expect(await vis('104', '2d')).toBe(false);
  });
});
