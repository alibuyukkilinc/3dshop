import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { StoresService } from '../src/modules/commerce/public/index.js';
import { WorldService } from '../src/modules/world/public/index.js';
import { adminSession } from './support/admin-session.js';
import { createTestApp } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

describe.skipIf(!hasDatabase)('mekân (F3.1, K40)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let world: WorldService;
  let storeId = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp(db);
    prisma = app.get(PrismaService);
    world = app.get(WorldService);
    storeId = (
      await prisma.$transaction((tx) =>
        app.get(StoresService).ensureStore(tx, { slug: 'esensolarmarket', storeName: 'Esen Solar Market', companyDisplayName: 'Esen' }),
      )
    ).storeId;
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('pilot şehir: 3 bölge, tramvay 3 durak batıdan doğuya, doğuş noktası; ikinci çağrı bir şey değiştirmez', async () => {
    const a = await world.ensurePilotWorlds();
    expect(a.created).toBe(true);
    expect((await world.ensurePilotWorlds()).created).toBe(false);
    const [city] = (await world.worlds()).filter((w) => w.slug === 'merkez-sehir');
    expect(city!.regions.map((r) => r.slug)).toEqual(['merkez-meydan', 'enerji-carsisi', 'egitim-sokagi']);
    const stations = city!.transit_lines[0]!.stations;
    const xs = await Promise.all(stations.map(async (st) => (await prisma.placeVirtual.findUniqueOrThrow({ where: { placeId: st.place_id } })).x));
    expect(stations.map((st) => st.name)).toEqual(['Eğitim Sokağı durağı', 'Merkez Meydan durağı', 'Enerji Çarşısı durağı']);
    expect(xs).toEqual([-100, 0, 100]);
    expect(await prisma.fastTravelTarget.count()).toBe(3);
    expect((await prisma.world.findUniqueOrThrow({ where: { slug: 'merkez-sehir' } })).defaultSpawnPlaceId).not.toBeNull();
  });

  it('şube pini ilçe merkezinde; yakındakiler haversine ile', async () => {
    const b = await world.ensureBranch({ storeId, name: 'Esen Solar Market', districtCode: '37-tosya' });
    expect((await world.ensureBranch({ storeId, name: 'x', districtCode: '37-tosya' })).placeId).toBe(b.placeId);
    const [pin] = await world.branches();
    expect(pin).toMatchObject({ store_id: storeId, geo: { lat: 41.0167, lng: 34.0333, precision: 'district_center', province: 'Kastamonu', district: 'Tosya' } });
    expect((await world.nearbyBranches(41.39, 33.78, 50)).map((x) => x.name)).toEqual(['Esen Solar Market']);
    expect(await world.nearbyBranches(39.93, 32.86, 50)).toEqual([]);
    await expect(world.ensureBranch({ storeId: crypto.randomUUID(), name: 'x', districtCode: 'yok' })).rejects.toThrow();
  });

  it('pin değişikliği yayından geçer; Türkiye dışı reddedilir; geri alınabilir', async () => {
    const admin = await adminSession(app, 'admin@example.com', ['platform_admin', 'approver']);
    const [pin] = await world.branches();
    const bad = await admin.post('/admin/v1/changesets', {
      title: 'Yanlış pin',
      items: [{ entity_type: 'map_pin', entity_id: pin!.place_id, op: 'update', payload: { lat: 34.03, lng: 41.01, precision: 'exact' } }],
    });
    expect(bad.status).toBe(422);
    const cs = await admin.post('/admin/v1/changesets', {
      title: 'Esen gerçek adres',
      items: [
        {
          entity_type: 'map_pin',
          entity_id: pin!.place_id,
          op: 'update',
          payload: { lat: 41.0141, lng: 34.0387, precision: 'exact', address_line: 'Tosya, Kastamonu' },
        },
      ],
    });
    await admin.post(`/admin/v1/changesets/${cs.body.id}/submit`);
    await admin.post(`/admin/v1/changesets/${cs.body.id}/approve`, { self_approval_reason: 'Pilotta tek onaylayıcı var' });
    await admin.post(`/admin/v1/changesets/${cs.body.id}/publish`, {});
    const after = (await admin.get('/admin/v1/world/branches')).body.items[0];
    expect(after.geo).toMatchObject({ lat: 41.0141, precision: 'exact', source: 'manual' });
    expect(after.geo.verified_at).not.toBeNull();
    expect(await prisma.outboxEvent.count({ where: { eventType: 'world.place.changed' } })).toBe(1);
    const rb = await admin.post(`/admin/v1/changesets/${cs.body.id}/rollback`);
    expect(rb.body.items[0].payload).toMatchObject({ lat: 41.0167, precision: 'district_center' });
  });
});
