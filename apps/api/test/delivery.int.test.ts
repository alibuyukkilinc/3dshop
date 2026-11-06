import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadEnv, resetEnvCache } from '../src/infra/config/env.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { configureHttp } from '../src/infra/http/configure.js';
import { AssetsService } from '../src/modules/assets/public/index.js';
import { BundlesService } from '../src/modules/delivery/public/index.js';
import { PlacementService } from '../src/modules/placement/public/index.js';
import { SOURCE_CLIENT_FACTORY, SourceSitesService, SourceSyncService } from '../src/modules/integration/public/index.js';
import { VisibilityService } from '../src/modules/rules/public/index.js';
import { WorldService } from '../src/modules/world/public/index.js';
import { adminSession } from './support/admin-session.js';
import { makeGlb } from './support/glb.js';
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

describe.skipIf(!hasDatabase)('bölge paketi ve canlı katman (F4.1, K48)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let bundles: BundlesService;
  let admin: Awaited<ReturnType<typeof adminSession>>;
  const dir = mkdtempSync(join(tmpdir(), 'dtd-bundles-'));
  let sceneId = '';
  let storeId = '';
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.ASSETS_DIR = dir;
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.appUrl;
    process.env.APP_ORIGINS = ORIGIN;
    process.env.SECRETS_KEY ??= Buffer.alloc(32, 7).toString('base64');
    resetEnvCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SOURCE_CLIENT_FACTORY).useValue(() => source).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
    configureHttp(app as NestExpressApplication, loadEnv());
    await app.init();
    prisma = app.get(PrismaService);
    bundles = app.get(BundlesService);
    const sites = app.get(SourceSitesService);
    await sites.register({ code: 'esensolarmarket', baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen', storeName: 'Esen Solar Market' });
    await sites.setToken('esensolarmarket', 'test-token-0123456789abcdef');
    await app.get(SourceSyncService).run('esensolarmarket', 'full');
    storeId = (await prisma.store.findFirstOrThrow()).id;
    await prisma.store.update({ where: { id: storeId }, data: { status: 'active' } });
    await app.get(VisibilityService).recompute({ all: true });
    await app.get(WorldService).ensurePilotWorlds();
    admin = await adminSession(app, 'admin@example.com', ['platform_admin', 'approver']);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('yayında sahne yokken paket yok; manifest bölgeleri ve tramvayı verir', async () => {
    expect(await bundles.buildAll()).toBe(0);
    const m = (await http().get('/api/v1/worlds/merkez-sehir')).body;
    expect(m.regions.map((r: { slug: string; bundle_url: string | null }) => [r.slug, r.bundle_url])).toEqual([
      ['merkez-meydan', null],
      ['enerji-carsisi', null],
      ['egitim-sokagi', null],
    ]);
    expect(m.spawn).toEqual([0, 0, 60]);
    expect(m.transit_lines[0].stations.map((s: { position: number[] }) => s.position[0])).toEqual([-100, 0, 100]);
  });

  it('yayından sonra paket: model adresleri, mağaza girişi, yuvalara 3d kanalında görünen ürün panoları', async () => {
    const assets = app.get(AssetsService);
    const up = await assets.upload(await makeGlb(6), { name: 'Bina', kind: 'building' }, { actor: { type: 'admin', id: 'a' }, requestId: null, ipHash: null });
    await assets.processPending();
    await admin.put(`/admin/v1/assets/${up.asset_id}/license`, { license_type: 'cc0', verify: true });
    const region = await prisma.region.findFirstOrThrow({ where: { slug: 'enerji-carsisi' } });
    sceneId = (await admin.post('/admin/v1/scenes', { owner_type: 'region', owner_id: region.id, name: 'Enerji' })).body.id;
    const base = (await admin.get(`/admin/v1/scenes/${sceneId}/document`)).body;
    const doc = {
      ...base.document,
      nodes: [
        ...base.document.nodes,
        { id: 'bina', parent: null, transform: { p: [100, 0, -14], s: [10, 10, 10] }, components: [{ type: 'mesh', asset_version_id: up.version_id }] },
        { id: 'giris', parent: null, transform: { p: [100, 0, 4] }, components: [{ type: 'anchor', kind: 'store_entrance', ref_id: storeId }] },
        ...[0, 1, 2, 3, 4].map((k) => ({ id: `yuva-${k}`, parent: null, transform: { p: [94 + k * 3, 0, 8] }, components: [{ type: 'slot', slot_id: `esen-${k}` }] })),
        { id: 'uzak-yuva', parent: null, transform: { p: [180, 0, 8] }, components: [{ type: 'slot', slot_id: 'sahipsiz' }] },
      ],
    };
    const v = (await admin.post(`/admin/v1/scenes/${sceneId}/versions`, { base_number: 1, document: doc })).body;
    const cs = (await admin.post('/admin/v1/changesets', { title: 'Enerji', items: [{ entity_type: 'scene', entity_id: sceneId, op: 'publish', payload: { version_id: v.version_id } }] })).body;
    await admin.post(`/admin/v1/changesets/${cs.id}/submit`);
    await admin.post(`/admin/v1/changesets/${cs.id}/approve`, { self_approval_reason: 'Pilotta tek onaylayıcı var' });
    await admin.post(`/admin/v1/changesets/${cs.id}/publish`, {});
    // Yerleşim motoru yuvaları eşitler ve doldurur (K23); paket sonucu okur
    const run = await app.get(PlacementService).run('manual');
    expect(run).toMatchObject({ changed: true, placed: 3 });

    expect(await bundles.buildAll()).toBe(1);
    const m = (await http().get('/api/v1/worlds/merkez-sehir')).body;
    const url = m.regions.find((r: { slug: string }) => r.slug === 'enerji-carsisi').bundle_url as string;
    const res = await http().get(url);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const b = JSON.parse(res.text);
    expect(b.schema).toBe('dtd.region-bundle.v1');
    expect(b.stores).toEqual([{ id: storeId, slug: 'esensolarmarket', name: 'Esen Solar Market', entrance: [100, 0, 4] }]);
    expect(b.assets[up.version_id].lod1).toMatch(/^\/api\/v1\/assets\/files\/[0-9a-f]{64}\.glb$/);
    // 3 ürün 3d kanalında görünür (102 pasif, 103 stokta ama 104 dahil): 5 yuvanın 3'üne pano; uzak yuva boş
    expect(b.boards).toHaveLength(3);
    expect(b.boards.every((x: { store_id: string }) => x.store_id === storeId)).toBe(true);
    const board = b.document.nodes.find((n: { id: string }) => n.id === `pano-${b.boards[0].slot_id}`);
    expect(board.parent).toBe(`yuva-${b.boards[0].slot_id.split('-')[1]}`);
    expect(board.components[0]).toMatchObject({ type: 'board', product_id: b.boards[0].product_id });
    expect(JSON.stringify(b)).not.toMatch(/buy_price|777\.77/);

    // Aynı içerikle yeniden derleme işaretçiyi değiştirmez (istemci önbelleği geçerli)
    await bundles.buildAll();
    expect((await http().get('/api/v1/worlds/merkez-sehir')).body.regions.find((r: { slug: string }) => r.slug === 'enerji-carsisi').bundle_url).toBe(url);
  });

  it('yerleşim: pin kuraldan önce gelir, kural sırası uygulanır, yuva sahibi mağaza dışı ürün pinlenemez (K23)', async () => {
    const placement = app.get(PlacementService);
    const slots = (await admin.get('/admin/v1/placement/slots')).body.items as {
      id: string;
      slot_key: string;
      store_id: string | null;
      live: { product_id: string; source: string }[];
    }[];
    expect(slots.map((s) => s.slot_key).sort()).toEqual(['esen-0', 'esen-1', 'esen-2', 'esen-3', 'esen-4', 'sahipsiz']);
    expect(slots.find((s) => s.slot_key === 'sahipsiz')!.store_id).toBeNull();
    const visible = (await prisma.catalogProduct.findMany({ select: { id: true, externalId: true } })).filter((p) => ['101', '103', '104'].includes(p.externalId));
    const pinned = visible.find((p) => p.externalId === '104')!;
    const last = slots.find((s) => s.slot_key === 'esen-4')!;

    // Kural: fiyata göre azalan, pin: 104 son yuvada
    const cs = (
      await admin.post('/admin/v1/changesets', {
        title: 'Vitrin',
        items: [
          { entity_type: 'placement_rule', op: 'create', payload: { name: 'Pahalıdan ucuza', store_id: storeId, sort_by: 'price_desc', priority: 10 } },
          { entity_type: 'placement_pin', op: 'create', payload: { slot_id: last.id, product_id: pinned.id, reason: 'Kampanya ürünü' } },
        ],
      })
    ).body;
    expect(cs.id).toBeTruthy();
    await admin.post(`/admin/v1/changesets/${cs.id}/submit`);
    await admin.post(`/admin/v1/changesets/${cs.id}/approve`, { self_approval_reason: 'Pilotta tek onaylayıcı var' });
    expect((await admin.post(`/admin/v1/changesets/${cs.id}/publish`, {})).status).toBe(200);

    const run = await placement.run('manual');
    expect(run.changed).toBe(true);
    const after = (await admin.get('/admin/v1/placement/slots')).body.items as typeof slots;
    const lastLive = after.find((s) => s.slot_key === 'esen-4')!.live;
    expect(lastLive).toEqual([expect.objectContaining({ product_id: pinned.id, source: 'pin' })]);
    const ruled = after.filter((s) => s.live[0]?.source === 'rule');
    expect(ruled).toHaveLength(2);
    // Aynı ürün iki yuvada olmaz
    const all = after.flatMap((s) => s.live.map((l) => l.product_id));
    expect(new Set(all).size).toBe(all.length);
    // Değişiklik yoksa canlı değişmez
    expect((await placement.run('manual')).changed).toBe(false);

    // Paket pini yansıtır
    await bundles.buildAll();
    const m = (await http().get('/api/v1/worlds/merkez-sehir')).body;
    const b = JSON.parse((await http().get(m.regions.find((r: { slug: string }) => r.slug === 'enerji-carsisi').bundle_url)).text);
    expect(b.boards.find((x: { slot_id: string }) => x.slot_id === 'esen-4').product_id).toBe(pinned.id);

    // Başka mağazanın yuvasına / olmayan ürün pinlenemez
    const bad = await admin.post('/admin/v1/changesets', {
      title: 'Hatalı pin',
      items: [{ entity_type: 'placement_pin', op: 'create', payload: { slot_id: last.id, product_id: '01a1aefe-49cb-7ce5-bbac-7939232425a9', reason: 'deneme' } }],
    });
    expect(bad.status).toBe(422);
  });

  it('canlı fiyat: yalnız görünen ürünler; geçersiz kimlik atılır', async () => {
    const ids = (await prisma.catalogProduct.findMany({ select: { id: true, externalId: true } })).sort((a, b) => a.externalId.localeCompare(b.externalId));
    const res = await http().get(`/api/v1/live/prices?ids=${ids.map((i) => i.id).join(',')},kotu`);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    const byExt = new Map(ids.map((i) => [i.id, i.externalId]));
    expect(res.body.items.map((i: { product_id: string }) => byExt.get(i.product_id)).sort()).toEqual(['101', '103', '104']);
    expect(res.body.items.find((i: { product_id: string }) => byExt.get(i.product_id) === '101').price.final_minor).toBe(1470890);
  });
});
