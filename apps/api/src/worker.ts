import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './infra/config/env.js';
import { DbModule } from './infra/db/db.module.js';
import { PrismaService } from './infra/db/prisma.service.js';
import { AuditModule, AuditVerifier } from './modules/audit/public/index.js';
import {
  IntegrationModule,
  OPEN_AFTER,
  SourceSitesService,
  SourceSyncService,
  SyncBusyError,
  WebhooksService,
} from './modules/integration/public/index.js';
import { AlertMailer, AlertService, ErrorReporter, OpsWorkerModule } from './modules/ops/public/index.js';
import { OutboxRelay, PlatformModule } from './modules/platform/public/index.js';
import { AssetsModule, AssetsService } from './modules/assets/public/index.js';
import { BundlesService, DeliveryEventHandler, DeliveryModule } from './modules/delivery/public/index.js';
import { AnalyticsModule, ConversionEventHandler, EventsService } from './modules/analytics/public/index.js';
import { PlacementEventHandler, PlacementModule, PlacementService } from './modules/placement/public/index.js';
import { ChangesetsService, PublishingModule } from './modules/publishing/public/index.js';
import { DiscoveryModule, GuideService } from './modules/discovery/public/index.js';
import { RulesModule, VisibilityEventHandler, VisibilityService } from './modules/rules/public/index.js';

/**
 * Worker (pm2: dtd-worker). Aynı modülleri API'den ayrı bir süreçte çalıştırır: outbox teslimi, zamanlanmış
 * işler. Kuyruk (Redis + BullMQ, K34) F0.6'da sunucuya Redis kurulunca eklenir; o zamana kadar outbox
 * yoklamayla teslim edilir.
 */
@Module({ imports: [DbModule, PlatformModule, AuditModule, OpsWorkerModule, IntegrationModule, RulesModule, PublishingModule, AssetsModule, PlacementModule, DeliveryModule, AnalyticsModule, DiscoveryModule] })
class WorkerModule {}

const OUTBOX_POLL_MS = 1_000;
const HOURLY_MS = 3_600_000;
/** Kaynak eşitleme zamanlayıcısı: her dakika zamanı gelen siteler sırayla eşitlenir (K42) */
const SYNC_TICK_MS = 60_000;
const WEBHOOK_TICK_MS = 10_000;

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const logger = new Logger('worker');
  const relay = app.get(OutboxRelay);
  const prisma = app.get(PrismaService);
  const verifier = app.get(AuditVerifier);
  const reporter = app.get(ErrorReporter);
  const alerts = app.get(AlertService);
  relay.register(app.get(AlertMailer));
  // Görünürlük: katalog/ticari olaylarla artımlı yeniden hesap (K43)
  relay.register(app.get(VisibilityEventHandler));
  // Bölge paketleri: sahne/görünürlük/varlık olayları paketleri kirli işaretler (K48)
  relay.register(app.get(DeliveryEventHandler));
  // Yerleşim: sahne/görünürlük/ürün/kural olayları çalıştırmayı kirli işaretler (K23)
  relay.register(app.get(PlacementEventHandler));
  // Dönüşüm: kaynak sitenin sipariş olayı yönlendirmeyle eşlenir (K53)
  relay.register(app.get(ConversionEventHandler));
  const visibility = app.get(VisibilityService);
  process.on('unhandledRejection', (reason) => void reporter.report(reason, 'worker', { kind: 'unhandledRejection' }));
  let stopping = false;

  const maintenance = async () => {
    // Bu ayın ve gelecek ayın denetim bölümü (K47)
    await prisma.$queryRaw`SELECT audit.ensure_month_partition(current_date)`;
    await prisma.$queryRaw`SELECT audit.ensure_month_partition((current_date + interval '1 month')::date)`;
    // Ölü mektuplar (K51): platform modülü ops'u bilemez; burada sayılıp uyarıya çevrilir (saatte en çok bir e-posta)
    const dead = await prisma.outboxEvent.count({ where: { dead: true } });
    if (dead > 0) {
      await alerts.raise({
        key: 'outbox:dead_letters',
        subject: `[${loadEnv().ENV_LABEL}] ${dead} olay teslim edilemedi (ölü mektup)`,
        text: `platform.outbox'ta ${dead} olay denemeleri tükendiği için bekliyor. Yönetim paneli → Sistem durumu.`,
      });
    }
  };
  await maintenance();
  // Platform olayları (K37): bölümler, 13 ay saklama, günlük özet (bugün + dün); rehber sohbet saklaması. Saatte bir.
  const events = app.get(EventsService);
  const guide = app.get(GuideService);
  const eventsJob = async () => {
    try {
      const dropped = await events.maintainPartitions();
      if (dropped.length) logger.log(`Saklama süresi dolan olay bölümleri silindi: ${dropped.join(', ')}`);
      await events.summarizeRecent();
      // AI rehber sohbetleri 30 gün (K52)
      await guide.purgeExpired();
    } catch (e) {
      await reporter.report(e, 'job', { job: 'analytics_events' });
    }
  };
  void eventsJob();
  const eventsTimer = setInterval(() => void eventsJob(), HOURLY_MS);
  // Görünürlük tam hesabı: açılışta ve saatte bir (kural geçerlilik sınırları, kaçan olaylar). Gece fark raporu
  // ayrıca gerekmez: tam hesap değişen her hedef için rules.visibility.changed üretir.
  const fullVisibility = () => visibility.recompute({ all: true }).catch((e) => reporter.report(e, 'job', { job: 'visibility_full' }));
  void fullVisibility();
  const visibilityTimer = setInterval(() => void fullVisibility(), HOURLY_MS);
  const maintenanceTimer = setInterval(
    () => void maintenance().catch((e) => reporter.report(e, 'job', { job: 'audit_partitions' })),
    HOURLY_MS,
  );

  const nightly = setInterval(async () => {
    if (new Date().getUTCHours() !== 0) return;
    try {
      const check = await verifier.verify();
      if (!check.ok) {
        logger.error(`Denetim zinciri bozuk: seq ${check.brokenAtSeq}`);
        await alerts.raise({
          key: 'audit:chain_broken',
          subject: `[${loadEnv().ENV_LABEL}] Denetim kaydı zinciri bozuk`,
          text: `audit.audit_log zinciri seq ${check.brokenAtSeq} satırında kırık. Kayıt değiştirilmiş olabilir (K47).`,
        });
      }
    } catch (e) {
      await reporter.report(e, 'job', { job: 'audit_verify' });
    }
  }, HOURLY_MS);

  // Kaynak eşitleme (F1.1). Outbox döngüsünden ayrı: uzun süren bir tam eşitleme olay teslimini bekletmez.
  const sync = app.get(SourceSyncService);
  const sources = app.get(SourceSitesService);
  let syncing = false;
  const syncTick = async () => {
    if (syncing || stopping) return;
    syncing = true;
    try {
      for (const { code, kind } of await sync.dueSites()) {
        if (stopping) break;
        try {
          await sync.run(code, kind);
        } catch (e) {
          if (!(e instanceof SyncBusyError)) logger.warn(`${code} ${kind} eşitleme hatası: ${(e as Error).message}`);
        }
      }
      // İndirimi biten ürünler (K42): kaynak date_updated'i değiştirmediği için delta yakalamaz
      if (!stopping) await sync.refreshExpiredPrices();
      for (const site of await sources.failing(OPEN_AFTER)) {
        await alerts.raise({
          key: `integration:site_failing:${site.code}`,
          subject: `[${loadEnv().ENV_LABEL}] ${site.code} eşitlenemiyor (${site.consecutiveFailures} kez)`,
          text: `Son hata: ${site.lastError ?? '-'}
Site ${site.circuitOpenUntil?.toISOString() ?? '-'} zamanına kadar bekletiliyor.`,
        });
      }
    } catch (e) {
      await reporter.report(e, 'job', { job: 'source_sync' });
    } finally {
      syncing = false;
    }
  };
  // Zamanlanmış yayınlar (K44)
  const changesets = app.get(ChangesetsService);
  const publishTimer = setInterval(
    () => void changesets.publishDue().catch((e) => reporter.report(e, 'job', { job: 'scheduled_publish' })),
    SYNC_TICK_MS,
  );

  // 3D varlık işleme (F3.2): doğrulama, optimizasyon, LOD
  const assets = app.get(AssetsService);
  let processingAssets = false;
  const assetTimer = setInterval(async () => {
    if (processingAssets || stopping) return;
    processingAssets = true;
    try {
      await assets.processPending();
    } catch (e) {
      await reporter.report(e, 'job', { job: 'asset_processing' });
    } finally {
      processingAssets = false;
    }
  }, 5_000);

  // Yerleşim: kirliyse dakikada bir, ayrıca saatlik tam çalıştırma (geçerlilik pencereleri, popülerlik)
  const placement = app.get(PlacementService);
  let placing = false;
  const placementTick = async (full: boolean) => {
    if (placing || stopping) return;
    placing = true;
    try {
      if (full) await placement.run('schedule');
      else await placement.runIfDirty();
    } catch (e) {
      await reporter.report(e, 'job', { job: 'placement' });
    } finally {
      placing = false;
    }
  };
  const placementTimer = setInterval(() => void placementTick(false), 60_000);
  const placementHourly = setInterval(() => void placementTick(true), HOURLY_MS);

  const bundles = app.get(BundlesService);
  const bundleTimer = setInterval(
    () => void bundles.buildIfDirty().catch((e) => reporter.report(e, 'job', { job: 'region_bundles' })),
    30_000,
  );

  const syncTimer = loadEnv().INTEGRATION_SYNC_ENABLED ? setInterval(() => void syncTick(), SYNC_TICK_MS) : null;
  if (syncTimer) void syncTick();

  // Gelen webhook kutusu (F1.4): eşitlemeden sık, böylece kaynaktaki değişiklik saniyeler içinde aynaya geçer
  const webhooks = app.get(WebhooksService);
  let hooking = false;
  const webhookTimer = setInterval(async () => {
    if (hooking || stopping) return;
    hooking = true;
    try {
      await webhooks.processPending();
    } catch (e) {
      await reporter.report(e, 'job', { job: 'webhook_inbox' });
    } finally {
      hooking = false;
    }
  }, WEBHOOK_TICK_MS);

  const stop = () => {
    stopping = true;
    clearInterval(maintenanceTimer);
    clearInterval(eventsTimer);
    clearInterval(nightly);
    if (syncTimer) clearInterval(syncTimer);
    clearInterval(webhookTimer);
    clearInterval(visibilityTimer);
    clearInterval(publishTimer);
    clearInterval(assetTimer);
    clearInterval(bundleTimer);
    clearInterval(placementTimer);
    clearInterval(placementHourly);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  logger.log('Worker hazır.');
  while (!stopping) {
    try {
      const n = await relay.runOnce();
      if (n === 0) await new Promise((r) => setTimeout(r, OUTBOX_POLL_MS));
    } catch (error) {
      await reporter.report(error, 'worker', { kind: 'outbox_loop' });
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  await app.close();
}

void bootstrap();
