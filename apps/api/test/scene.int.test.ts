import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { WorldService } from '../src/modules/world/public/index.js';
import { adminSession } from './support/admin-session.js';
import { createTestApp } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

describe.skipIf(!hasDatabase)('sahne sürümleri ve yayını (F3.3, K45)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof adminSession>>;
  let sceneId = '';
  let regionId = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp(db);
    prisma = app.get(PrismaService);
    await app.get(WorldService).ensurePilotWorlds();
    regionId = (await prisma.region.findFirstOrThrow({ where: { slug: 'enerji-carsisi' } })).id;
    admin = await adminSession(app, 'admin@example.com', ['platform_admin', 'approver']);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('bölgeye sahne açılır: başlangıç sürümü 1 (ışık + zemin); ikinci çağrı aynı sahneyi verir', async () => {
    const a = await admin.post('/admin/v1/scenes', { owner_type: 'region', owner_id: regionId, name: 'Enerji Çarşısı' });
    expect(a.body.created).toBe(true);
    sceneId = a.body.id;
    expect((await admin.post('/admin/v1/scenes', { owner_type: 'region', owner_id: regionId, name: 'x y' })).body).toEqual({ id: sceneId, created: false });
    const d = (await admin.get(`/admin/v1/scenes/${sceneId}/document`)).body;
    expect(d.number).toBe(1);
    expect(d.document.nodes.map((n: { id: string }) => n.id)).toEqual(['isik-gok', 'isik-gunes', 'zemin']);
  });

  it('kaydetme yeni sürüm; eski tabanla 409; aynı içerik yeni sürüm açmaz; geçersiz belge 422; sürüm değiştirilemez', async () => {
    const base = (await admin.get(`/admin/v1/scenes/${sceneId}/document`)).body.document;
    const doc = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 'durak', parent: null, transform: { p: [100, 0, 20] }, components: [{ type: 'anchor', kind: 'station', ref_id: 'p-1' }] },
        { id: 'yuva-1', parent: null, transform: { p: [90, 0, -10] }, components: [{ type: 'slot', slot_id: 'esen-vitrin-1' }] },
      ],
    };
    const v2 = await admin.post(`/admin/v1/scenes/${sceneId}/versions`, { base_number: 1, document: doc, note: 'durak ve yuva' });
    expect(v2.body).toMatchObject({ number: 2, unchanged: false });
    expect((await admin.post(`/admin/v1/scenes/${sceneId}/versions`, { base_number: 1, document: doc })).status).toBe(409);
    expect((await admin.post(`/admin/v1/scenes/${sceneId}/versions`, { base_number: 2, document: doc })).body).toMatchObject({ number: 2, unchanged: true });
    const bad = await admin.post(`/admin/v1/scenes/${sceneId}/versions`, {
      base_number: 2,
      document: { ...doc, nodes: [...doc.nodes, { id: 'durak', parent: null }] },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toContain('Yinelenen');
    const idx = await prisma.sceneNodeIndex.findMany({ where: { sceneVersionId: v2.body.version_id }, orderBy: { nodeId: 'asc' } });
    expect(idx.map((n) => [n.nodeId, n.kind, n.refId])).toEqual([
      ['durak', 'anchor:station', 'p-1'],
      ['yuva-1', 'slot', 'esen-vitrin-1'],
    ]);
    await expect(prisma.sceneVersion.update({ where: { id: v2.body.version_id }, data: { note: 'x' } })).rejects.toThrow(); // dtd_app'te UPDATE yetkisi yok; sahip rolüne karşı tetikleyici
  });

  it('yayın: canlı işaretçi seçilen sürüme; herkese açık uç onu verir; geri alma önceki sürüme döner', async () => {
    const pub = (n: number, vid: string) =>
      admin.post('/admin/v1/changesets', { title: `Sahne v${n}`, items: [{ entity_type: 'scene', entity_id: sceneId, op: 'publish', payload: { version_id: vid } }] });
    const flow = async (id: string) => {
      await admin.post(`/admin/v1/changesets/${id}/submit`);
      await admin.post(`/admin/v1/changesets/${id}/approve`, { self_approval_reason: 'Pilotta tek onaylayıcı var' });
      return admin.post(`/admin/v1/changesets/${id}/publish`, {});
    };
    expect((await request(app.getHttpServer()).get(`/api/v1/scenes/${sceneId}/live`)).status).toBe(404);
    const versions = (await admin.get(`/admin/v1/scenes/${sceneId}/versions`)).body.items as { id: string; number: number }[];
    const v1 = versions.find((v) => v.number === 1)!.id;
    const v2 = versions.find((v) => v.number === 2)!.id;
    await flow((await pub(1, v1)).body.id);
    const cs2 = (await pub(2, v2)).body.id;
    await flow(cs2);
    const live = await request(app.getHttpServer()).get(`/api/v1/scenes/${sceneId}/live`);
    expect(live.body).toMatchObject({ number: 2, version_id: v2 });
    expect(await prisma.outboxEvent.count({ where: { eventType: 'scene.version.published' } })).toBe(2);

    const rb = await admin.post(`/admin/v1/changesets/${cs2}/rollback`);
    expect(rb.body.items[0].payload).toEqual({ version_id: v1 });
    await flow(rb.body.id);
    expect((await request(app.getHttpServer()).get(`/api/v1/scenes/${sceneId}/live`)).body.number).toBe(1);
  });
});
