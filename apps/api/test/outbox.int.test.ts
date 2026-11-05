import type { INestApplication } from '@nestjs/common';
import { SYSTEM_ACTOR } from '@dtd/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { MAX_ATTEMPTS, OutboxRelay, OutboxWriter } from '../src/modules/platform/public/index.js';
import { createTestApp } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

describe.skipIf(!hasDatabase)('outbox (K34, K51)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  const seen: string[] = [];
  let failNext = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp(db);
    prisma = app.get(PrismaService);
    const relay = app.get(OutboxRelay);
    relay.register({
      name: 'test.recorder',
      types: ['catalog.price.changed', 'catalog.stock.changed'],
      async handle(event) {
        if (failNext > 0) {
          failNext--;
          throw new Error('geçici hata');
        }
        seen.push(event.id);
      },
    });
    relay.register({
      name: 'test.always_fails',
      types: ['catalog.product.archived'],
      async handle() {
        throw new Error('kalıcı hata');
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  const append = (type: string) =>
    prisma.$transaction((tx) =>
      app.get(OutboxWriter).append(tx, {
        type,
        sourceModule: 'catalog',
        aggregate: { type: 'product', id: 'p1' },
        actor: SYSTEM_ACTOR,
        data: { x: 1 },
      }),
    );

  it('geri alınan transaction olay bırakmaz', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await app.get(OutboxWriter).append(tx, {
          type: 'catalog.price.changed',
          sourceModule: 'catalog',
          aggregate: { type: 'product', id: 'p0' },
          actor: SYSTEM_ACTOR,
          data: {},
        });
        throw new Error('iptal');
      }),
    ).rejects.toThrow('iptal');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('olay teslim edilir; geçici hatada yeniden denenir ve bir kez işlenir', async () => {
    const event = await append('catalog.price.changed');
    failNext = 1;
    const relay = app.get(OutboxRelay);
    await relay.runOnce();
    let row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.publishedAt).toBeNull();
    expect(row.attempts).toBe(1);

    await relay.runOnce(50, new Date(Date.now() + 60_000));
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.publishedAt).not.toBeNull();
    expect(seen.filter((id) => id === event.id)).toHaveLength(1);
  });

  it('denemeler tükenince ölü mektup olur', async () => {
    const event = await append('catalog.product.archived');
    const relay = app.get(OutboxRelay);
    let t = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await relay.runOnce(50, new Date(t));
      t += 24 * 3_600_000;
    }
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.dead).toBe(true);
    expect(row.lastError).toContain('kalıcı hata');
  });
});
