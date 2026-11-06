import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { EventsService, istanbulDay } from '../src/modules/analytics/public/index.js';
import { adminSession } from './support/admin-session.js';
import { client, createTestApp } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

describe.skipIf(!hasDatabase)('platform olayları ve GA4 ayarı (F5.4, K15, K37)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  const sid = uuidv7();
  const pid = uuidv7();

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp(db);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('geçerli paket kaydedilir; kişisel alan atılır, arama terimi küçük harf', async () => {
    const api = client(app);
    const r = await api.post('/v1/events', {
      session_id: sid,
      events: [
        { name: 'page_view', props: { path: '/urun/x', email: 'a@b.c' } },
        { name: 'product_view', props: { product_id: pid, surface: '2d' } },
        { name: 'product_view', props: { product_id: pid, surface: '3d' } },
        { name: 'search', props: { q: 'İnverter', results: 3 } },
      ],
    });
    expect(r.status).toBe(204);
    const rows = await prisma.analyticsEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(rows.map((e) => e.name)).toEqual(['page_view', 'product_view', 'product_view', 'search']);
    expect(rows[0]?.props).toEqual({ path: '/urun/x' });
    expect(rows[1]?.productId).toBe(pid);
    expect(rows[3]?.props).toEqual({ q: 'inverter', results: 3 });
  });

  it('bilinmeyen olay, Origin dışı istek reddedilir', async () => {
    const api = client(app);
    expect((await api.post('/v1/events', { session_id: sid, events: [{ name: 'login', props: {} }] })).status).toBe(400);
    const noOrigin = await api.raw.post('/api/v1/events').send({ session_id: sid, events: [{ name: 'page_view', props: { path: '/' } }] });
    expect(noOrigin.status).toBe(403);
  });

  it('günlük özet: toplam, oturum ve ürün/terim kırılımı; yönetim özeti', async () => {
    const events = app.get(EventsService);
    await events.summarizeDay(istanbulDay(new Date()));
    await events.summarizeDay(istanbulDay(new Date())); // tekrar çalıştırma aynı sonucu verir
    const daily = await prisma.analyticsEventDaily.findMany();
    const pv = daily.find((d) => d.name === 'product_view' && d.subject === '');
    expect(pv).toMatchObject({ events: 2, sessions: 1 });
    expect(daily.find((d) => d.name === 'product_view' && d.subject === pid)?.events).toBe(2);
    expect(daily.find((d) => d.name === 'search' && d.subject === 'inverter')?.events).toBe(1);

    const admin = await adminSession(app, 'olay@example.com', ['platform_admin']);
    const s = await admin.get('/admin/v1/analytics/events?days=7');
    expect(s.status).toBe(200);
    expect(s.body.totals.find((t: { name: string }) => t.name === 'product_view').events).toBe(2);
    expect(s.body.top.products[0]).toEqual({ subject: pid, events: 2 });
    expect(s.body.top.searches[0]).toEqual({ subject: 'inverter', events: 1 });
  });

  it('saklama: 13 aydan eski aylık bölüm silinir, yeni bölümler açılır', async () => {
    const events = app.get(EventsService);
    await prisma.$queryRaw`SELECT analytics.ensure_events_partition('2024-01-15'::date)`;
    const dropped = await events.maintainPartitions(new Date('2026-11-06T00:00:00Z'));
    expect(dropped).toContain('events_2024_01');
    const parts = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'events'`;
    const names = parts.map((p) => p.relname);
    expect(names).toContain('events_2026_12');
    expect(names).not.toContain('events_2024_01');
    // Uygulama rolü ham olayı değiştiremez (yalnız ekleme)
    await expect(prisma.$executeRaw`UPDATE analytics.events SET name = 'x'`).rejects.toThrow();
  });

  it('GA4: varsayılan kapalı; yönetici kimliği girer, site-config döner, denetime yazılır', async () => {
    const api = client(app);
    expect((await api.get('/v1/site-config')).body).toEqual({ ga4_measurement_id: null });
    const admin = await adminSession(app, 'ga4@example.com', ['platform_admin']);
    expect((await admin.put('/admin/v1/analytics/ga4', { measurement_id: 'UA-123' })).status).toBe(400);
    const ok = await admin.put('/admin/v1/analytics/ga4', { measurement_id: 'g-abc123xyz9' });
    expect(ok.status).toBe(200);
    expect(ok.body.measurement_id).toBe('G-ABC123XYZ9');
    expect((await api.get('/v1/site-config')).body).toEqual({ ga4_measurement_id: 'G-ABC123XYZ9' });
    expect(await prisma.auditLog.count({ where: { action: 'analytics.ga4.updated' } })).toBe(1);

    const editor = await adminSession(app, 'editor-ga4@example.com', ['editor']);
    expect((await editor.put('/admin/v1/analytics/ga4', { measurement_id: null })).status).toBe(403);
  });
});
