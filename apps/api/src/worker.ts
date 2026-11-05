import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './infra/config/env.js';
import { DbModule } from './infra/db/db.module.js';
import { PrismaService } from './infra/db/prisma.service.js';
import { AuditModule, AuditVerifier } from './modules/audit/public/index.js';
import { OutboxRelay, PlatformModule } from './modules/platform/public/index.js';

/**
 * Worker (pm2: dtd-worker). Aynı modülleri API'den ayrı bir süreçte çalıştırır: outbox teslimi, zamanlanmış
 * işler. Kuyruk (Redis + BullMQ, K34) F0.6'da sunucuya Redis kurulunca eklenir; o zamana kadar outbox
 * yoklamayla teslim edilir.
 */
@Module({ imports: [DbModule, PlatformModule, AuditModule] })
class WorkerModule {}

const OUTBOX_POLL_MS = 1_000;
const HOURLY_MS = 3_600_000;

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const logger = new Logger('worker');
  const relay = app.get(OutboxRelay);
  const prisma = app.get(PrismaService);
  const verifier = app.get(AuditVerifier);
  let stopping = false;

  const maintenance = async () => {
    // Bu ayın ve gelecek ayın denetim bölümü (K47)
    await prisma.$queryRaw`SELECT audit.ensure_month_partition(current_date)`;
    await prisma.$queryRaw`SELECT audit.ensure_month_partition((current_date + interval '1 month')::date)`;
  };
  await maintenance();
  const maintenanceTimer = setInterval(() => void maintenance().catch((e) => logger.error(e)), HOURLY_MS);

  const nightly = setInterval(async () => {
    if (new Date().getUTCHours() !== 0) return;
    const check = await verifier.verify();
    if (!check.ok) logger.error(`Denetim zinciri bozuk: seq ${check.brokenAtSeq}`);
  }, HOURLY_MS);

  const stop = () => {
    stopping = true;
    clearInterval(maintenanceTimer);
    clearInterval(nightly);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  logger.log('Worker hazır.');
  while (!stopping) {
    try {
      const n = await relay.runOnce();
      if (n === 0) await new Promise((r) => setTimeout(r, OUTBOX_POLL_MS));
    } catch (error) {
      logger.error(error);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  await app.close();
}

void bootstrap();
