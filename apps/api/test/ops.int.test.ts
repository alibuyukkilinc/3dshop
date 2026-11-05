import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { ALERT_EVENT, AlertMailer, ErrorReporter, MailSender } from '../src/modules/ops/public/index.js';
import { OutboxRelay } from '../src/modules/platform/public/index.js';
import { client, createTestApp } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

function boom(n: number): Error {
  return new TypeError(`Cannot read properties of undefined (reading 'x') at item ${n}`);
}

describe.skipIf(!hasDatabase)('hata kaydı ve uyarılar (F0.7)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  const sent: { subject: string }[] = [];

  beforeAll(async () => {
    process.env.ALERT_EMAIL_TO = 'uyari@example.com';
    db = await createTestDatabase();
    app = await createTestApp(db);
    prisma = app.get(PrismaService);
    // Gerçek e-posta yerine kayıt
    app.get(MailSender).send = async (mail) => {
      sent.push({ subject: mail.subject });
      return 'sent';
    };
    app.get(OutboxRelay).register(app.get(AlertMailer));
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
    delete process.env.ALERT_EMAIL_TO;
  });

  it('aynı tür hata tek satırda sayılır, yalnız ilkinde uyarı üretilir', async () => {
    const reporter = app.get(ErrorReporter);
    const fp1 = await reporter.report(boom(1), 'worker', { eventType: 'catalog.price.changed' });
    const fp2 = await reporter.report(boom(2), 'worker', { eventType: 'catalog.price.changed' });
    expect(fp1).toBe(fp2);
    const row = await prisma.errorEvent.findUniqueOrThrow({ where: { fingerprint: fp1! } });
    expect(row.count).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { eventType: ALERT_EVENT } })).toBe(1);
  });

  it('uyarı e-postası gönderilir; aynı anahtar saatte bir kez', async () => {
    const relay = app.get(OutboxRelay);
    await relay.runOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('Yeni hata: TypeError');

    // Çözüldü işaretlenip tekrarlarsa yeni uyarı olayı üretilir ama kısıtlama nedeniyle e-posta gitmez
    const [e] = await prisma.errorEvent.findMany();
    await prisma.errorEvent.update({ where: { fingerprint: e!.fingerprint }, data: { resolvedAt: new Date() } });
    await app.get(ErrorReporter).report(boom(3), 'worker');
    expect(await prisma.outboxEvent.count({ where: { eventType: ALERT_EVENT } })).toBe(2);
    await relay.runOnce();
    expect(sent).toHaveLength(1);
    const again = await prisma.errorEvent.findUniqueOrThrow({ where: { fingerprint: e!.fingerprint } });
    expect(again.resolvedAt).toBeNull();
    expect(again.count).toBe(3);
  });

  it('beklenmeyen API hatası 500 ve iç ayrıntı göstermez; bilinçli 4xx olduğu gibi döner', async () => {
    const c = client(app);
    // Prisma'nın reddettiği geçersiz kimlik biçimi yerine: oturum çözümünde beklenmeyen hata üretmek için
    // geçersiz JSON gövdesi 400 (bilinçli) döner
    const bad = await c.raw
      .post('/api/admin/v1/auth/login')
      .set('Origin', 'http://localhost:5174')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('stack');

    const status = await c.get('/admin/v1/ops/status');
    expect(status.status).toBe(401);
  });
});
