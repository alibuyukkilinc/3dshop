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
import { OutboxRelay } from '../src/modules/platform/public/index.js';
import { ChangesetsService } from '../src/modules/publishing/public/index.js';
import { VisibilityEventHandler } from '../src/modules/rules/public/index.js';
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

describe.skipIf(!hasDatabase)('yayın akışı (F2.2, K44, K13)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let relay: OutboxRelay;
  let admin: Awaited<ReturnType<typeof adminSession>>;
  let storeId = '';
  const drain = async () => {
    while ((await relay.runOnce()) > 0);
  };
  const visible2d = async (ext: string) => {
    const p = await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: ext } });
    return (await prisma.visibilityResolved.findUniqueOrThrow({
      where: { targetType_targetId_channel: { targetType: 'product', targetId: p.id, channel: '2d' } },
    })).visible;
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
    relay = app.get(OutboxRelay);
    relay.register(app.get(VisibilityEventHandler));
    const sites = app.get(SourceSitesService);
    await sites.register({ code: 'esensolarmarket', baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen', storeName: 'Esen' });
    await sites.setToken('esensolarmarket', 'test-token-0123456789abcdef');
    await app.get(SourceSyncService).run('esensolarmarket', 'full');
    await drain();
    storeId = (await prisma.store.findFirstOrThrow()).id;
    admin = await adminSession(app, 'admin@example.com', ['platform_admin', 'approver']);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  let publishedId = '';

  it('tek onaylayıcı: gerekçesiz kendi onayı reddedilir, gerekçeyle self_approved; yayınla mağaza ve ürünleri görünür', async () => {
    const cs = await admin.post('/admin/v1/changesets', {
      title: 'Esen mağazasını yayına al',
      items: [{ entity_type: 'store', entity_id: storeId, op: 'publish', payload: {} }],
    });
    expect(cs.status).toBe(201);
    expect(cs.body.items[0]).toMatchObject({ label: 'Mağaza', before: { status: 'draft' } });
    expect((await admin.post(`/admin/v1/changesets/${cs.body.id}/publish`, {})).status).toBe(409); // onaysız
    expect((await admin.post(`/admin/v1/changesets/${cs.body.id}/submit`)).body.status).toBe('in_review');
    expect((await admin.post(`/admin/v1/changesets/${cs.body.id}/approve`, {})).status).toBe(409);
    const ok = await admin.post(`/admin/v1/changesets/${cs.body.id}/approve`, { self_approval_reason: 'Pilotta tek onaylayıcı var' });
    expect(ok.body).toMatchObject({ status: 'approved', self_approved: true });
    expect(await prisma.auditLog.count({ where: { action: 'publishing.changeset.approved' } })).toBe(1);

    const pub = await admin.post(`/admin/v1/changesets/${cs.body.id}/publish`, {});
    expect(pub.body.status).toBe('published');
    expect(pub.body.items[0].before).toEqual({ status: 'draft', name: 'Esen' });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).status).toBe('active');
    await drain();
    expect(await visible2d('101')).toBe(true);
    expect(await visible2d('102')).toBe(false); // kaynakta pasif
    publishedId = cs.body.id;
  });

  it('K13: yayın geri alınır — ters set taslak açılır, yayınlanınca mağaza önceki duruma döner', async () => {
    const rb = await admin.post(`/admin/v1/changesets/${publishedId}/rollback`);
    expect(rb.status).toBe(201);
    expect(rb.body).toMatchObject({ status: 'draft', rollback_of_id: publishedId });
    expect(rb.body.items[0]).toMatchObject({ entity_type: 'store', op: 'unpublish' });
    await admin.post(`/admin/v1/changesets/${rb.body.id}/submit`);
    await admin.post(`/admin/v1/changesets/${rb.body.id}/approve`, { self_approval_reason: 'Pilotta tek onaylayıcı var' });
    await admin.post(`/admin/v1/changesets/${rb.body.id}/publish`, {});
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).status).toBe('draft');
    expect((await admin.get(`/admin/v1/changesets/${publishedId}`)).body.rolled_back_by_id).toBe(rb.body.id);
    expect((await admin.post(`/admin/v1/changesets/${publishedId}/rollback`)).status).toBe(409);
    expect(await prisma.publicationHistory.count({ where: { entityId: storeId } })).toBe(2);
    await drain();
    expect(await visible2d('101')).toBe(false);
  });

  it('ikinci onaylayıcı varken hazırlayan kendi onaylayamaz; başkası onaylar', async () => {
    const other = await adminSession(app, 'onay@example.com', ['approver']);
    const cs = await admin.post('/admin/v1/changesets', {
      title: 'Yeniden yayın',
      items: [{ entity_type: 'store', entity_id: storeId, op: 'publish', payload: {} }],
    });
    await admin.post(`/admin/v1/changesets/${cs.body.id}/submit`);
    const self = await admin.post(`/admin/v1/changesets/${cs.body.id}/approve`, { self_approval_reason: 'Acil durum gerekçesi yazıldı' });
    expect(self.status).toBe(403);
    const ok = await other.post(`/admin/v1/changesets/${cs.body.id}/approve`, { comment: 'Uygun' });
    expect(ok.body).toMatchObject({ status: 'approved', self_approved: false });
    // Aynı mağaza başka açık sette olamaz
    const dup = await admin.post('/admin/v1/changesets', {
      title: 'Çakışan',
      items: [{ entity_type: 'store', entity_id: storeId, op: 'archive', payload: {} }],
    });
    expect(dup.status).toBe(409);
    // Zamanlama: worker zamanı gelince yayınlar
    const at = new Date(Date.now() + 120_000).toISOString();
    expect((await other.post(`/admin/v1/changesets/${cs.body.id}/publish`, { scheduled_at: at })).body.status).toBe('scheduled');
    expect(await app.get(ChangesetsService).publishDue(new Date(Date.now() + 180_000))).toBe(1);
    expect((await prisma.changeset.findUniqueOrThrow({ where: { id: cs.body.id } })).status).toBe('published');
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).status).toBe('active');
  });

  it('kural yayını: hukuki engeli yalnız platform_admin hazırlar; yayın sonrası kural seti sürümü artar ve hesap yenilenir', async () => {
    await drain();
    const editor = await adminSession(app, 'editor@example.com', ['editor']);
    const p101 = (await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: '101' } })).id;
    const legal = {
      code: 'KVKK_TEST_101',
      name: 'KVKK talebi',
      layer: 'mandatory_block',
      effect: 'deny',
      legal_ref: 'KVKK-2026-0042',
      targets: [{ type: 'product', id: p101, include: true }],
    };
    const denied = await editor.post('/admin/v1/changesets', { title: 'Engel', items: [{ entity_type: 'rule', op: 'create', payload: legal }] });
    expect(denied.status).toBe(422);
    expect(denied.body.message).toContain('platform yöneticisi');

    const noRef = await admin.post('/admin/v1/changesets', {
      title: 'Engel',
      items: [{ entity_type: 'rule', op: 'create', payload: { ...legal, legal_ref: null } }],
    });
    expect(noRef.status).toBe(422);

    const cs = await admin.post('/admin/v1/changesets', { title: 'KVKK engeli', items: [{ entity_type: 'rule', op: 'create', payload: legal }] });
    expect(cs.status).toBe(201);
    await admin.post(`/admin/v1/changesets/${cs.body.id}/submit`);
    const other = await prisma.adminUser.findFirstOrThrow({ where: { email: 'onay@example.com' } });
    expect(other).toBeTruthy();
    // ikinci onaylayıcı var: onu kullan
    const approver = await adminSession(app, 'onay2@example.com', ['approver']);
    await approver.post(`/admin/v1/changesets/${cs.body.id}/approve`, {});
    await approver.post(`/admin/v1/changesets/${cs.body.id}/publish`, {});
    expect((await prisma.rulesetVersion.aggregate({ _max: { number: true } }))._max.number).toBe(2);
    await drain();
    expect(await visible2d('101')).toBe(false);

    // Sistem kuralı değiştirilemez; hukuki engel arşivlenemez
    const sys = await prisma.rule.findFirstOrThrow({ where: { code: 'SYS_DEFAULT_VISIBLE' } });
    expect((await admin.post('/admin/v1/changesets', { title: 'Deneme', items: [{ entity_type: 'rule', entity_id: sys.id, op: 'archive', payload: {} }] })).status).toBe(422);
    const rule = await prisma.rule.findFirstOrThrow({ where: { code: 'KVKK_TEST_101' } });
    expect((await admin.post('/admin/v1/changesets', { title: 'Deneme', items: [{ entity_type: 'rule', entity_id: rule.id, op: 'archive', payload: {} }] })).status).toBe(422);
  });
});
