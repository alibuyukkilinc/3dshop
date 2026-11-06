import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { AssetsService } from '../src/modules/assets/public/index.js';
import { WorldService } from '../src/modules/world/public/index.js';
import { adminSession } from './support/admin-session.js';
import { makeGlb } from './support/glb.js';
import { createTestApp } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

describe.skipIf(!hasDatabase)('3D varlık hattı (F3.2, K38, K46)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let assets: AssetsService;
  let admin: Awaited<ReturnType<typeof adminSession>>;
  const dir = mkdtempSync(join(tmpdir(), 'dtd-assets-'));
  let assetId = '';
  let versionId = '';


  beforeAll(async () => {
    process.env.ASSETS_DIR = dir;
    db = await createTestDatabase();
    app = await createTestApp(db);
    prisma = app.get(PrismaService);
    assets = app.get(AssetsService);
    admin = await adminSession(app, 'admin@example.com', ['platform_admin', 'approver']);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('yükleme → iş kuyruğu → doğrulama + 3 LOD; dosyalar içerik adresli ve değişmez önbellekli', async () => {
    const glb = await makeGlb(30);
    const up = await assets.upload(glb, { name: 'Test zemin', kind: 'environment' }, { actor: { type: 'admin', id: 'a' }, requestId: null, ipHash: null });
    assetId = up.asset_id;
    versionId = up.version_id;
    expect(await assets.processPending()).toBe(1);
    const a = await assets.get(assetId);
    expect(a.status).toBe('ready');
    expect(a.versions[0]).toMatchObject({ status: 'ready', license_status: 'unknown', triangles: 1800 });
    expect(a.versions[0]!.files.map((f) => f.role).sort()).toEqual(['lod0', 'lod1', 'lod2', 'source']);
    const lod2 = a.versions[0]!.files.find((f) => f.role === 'lod2')!;
    const res = await request(app.getHttpServer()).get(`/api/v1/assets/files/${lod2.key}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['content-type']).toBe('model/gltf-binary');
    expect((await request(app.getHttpServer()).get('/api/v1/assets/files/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'assets.version.ready' } })).toBe(1);
  });

  it('HTTP yükleme: ham GLB gövdesi 201; JSON gövde 400; salt okuyucu yükleyemez', async () => {
    const ok = await admin.raw('/admin/v1/assets?name=Kutu&kind=prop&tags=deneme,kutu', await makeGlb(4), 'model/gltf-binary');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ number: 1 });
    expect((await admin.post('/admin/v1/assets?name=Kutu&kind=prop', { a: 1 })).status).toBe(400);
    const viewer = await adminSession(app, 'izleyici@example.com', ['approver']);
    expect((await viewer.raw('/admin/v1/assets?name=Kutu&kind=prop', await makeGlb(4), 'model/gltf-binary')).status).toBe(403);
    await assets.processPending();
    const list = (await admin.get('/admin/v1/assets?kind=prop')).body.items;
    expect(list.find((a: { name: string }) => a.name === 'Kutu')).toMatchObject({ status: 'ready', tags: ['deneme', 'kutu'] });
  });

  it('bozuk/zararlı dosya işlenmez: reddedilir, LOD üretilmez', async () => {
    const bad = await makeGlb(4, { externalUri: true });
    const up = await assets.upload(bad, { name: 'Kötü', kind: 'prop' }, { actor: { type: 'admin', id: 'a' }, requestId: null, ipHash: null });
    await assets.processPending();
    const a = await assets.get(up.asset_id);
    expect(a.status).toBe('rejected');
    expect(a.versions[0]!.files.map((f) => f.role)).toEqual(['source']);
    expect(JSON.stringify(a.versions[0]!.report)).toContain('uri');
  });

  it('K46: lisanssız varlıklı sahne yayınlanamaz; gerekçeli istisna ya da doğrulanmış lisansla yayınlanır', async () => {
    await app.get(WorldService).ensurePilotWorlds();
    const region = await prisma.region.findFirstOrThrow({ where: { slug: 'enerji-carsisi' } });
    const scene = (await admin.post('/admin/v1/scenes', { owner_type: 'region', owner_id: region.id, name: 'Enerji Çarşısı' })).body;
    const base = (await admin.get(`/admin/v1/scenes/${scene.id}/document`)).body;
    const doc = { ...base.document, nodes: [...base.document.nodes, { id: 'z', parent: null, components: [{ type: 'mesh', asset_version_id: versionId }] }] };
    const v = (await admin.post(`/admin/v1/scenes/${scene.id}/versions`, { base_number: 1, document: doc })).body;
    const open = () =>
      admin.post('/admin/v1/changesets', { title: 'Sahne', items: [{ entity_type: 'scene', entity_id: scene.id, op: 'publish', payload: { version_id: v.version_id } }] });
    const blocked = await open();
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toContain('lisans doğrulanmamış');

    expect((await admin.put(`/admin/v1/assets/${assetId}/license-exception`, { reason: 'kısa' })).status).toBe(409);
    await admin.put(`/admin/v1/assets/${assetId}/license-exception`, { reason: 'Kendi ürettiğimiz test modeli, lisans belgesi hazırlanıyor' });
    expect((await open()).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: 'assets.license.exception_granted' } })).toBe(1);

    await admin.put(`/admin/v1/assets/${assetId}/license`, { license_type: 'cc0', source_url: 'https://kenney.nl', attribution: 'Kenney', verify: true });
    expect((await assets.get(assetId)).versions[0]!.license_status).toBe('verified');
  });
});
