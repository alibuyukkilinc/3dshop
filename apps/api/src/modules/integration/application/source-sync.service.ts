import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Actor, uuidv7 } from '@dtd/contracts';
import { loadEnv } from '../../../infra/config/env.js';
import { decryptSecret } from '../../../infra/crypto/secrets.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { CatalogIngest, CatalogPriceExpiry } from '../../catalog/public/index.js';
import { isCircuitOpen, nextCircuitState } from '../domain/circuit.js';
import { productContentHash } from '../domain/content-hash.js';
import { EticaretProductSchema } from '../domain/eticaret/export-schema.js';
import { toProductV1 } from '../domain/eticaret/to-product-v1.js';
import { lastReconcileAt } from '../domain/schedule.js';
import { maxWatermark, requestSince } from '../domain/watermark.js';
import { EXPORT_PAGE_LIMIT, type ExportPage, type ExportPageQuery } from '../infrastructure/eticaret-client.js';

/** full: gece uzlaştırması (tüm ürünler, kaybolanlar işaretlenir); delta: filigrandan sonra değişenler */
export type SyncKind = 'full' | 'delta';

export interface SyncStats {
  pages: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  invalid: number;
  invalid_ids: string[];
  /**
   * Uzlaştırma sapması (yalnız full): delta'nın yakalamadığı, gece bulunan farklar (K42). Kur ve indirim bitişi
   * date_updated'i değiştirmediği için fiyatta sapma beklenir; kalan sapma webhook gelene kadar izlenir.
   */
  drift_ids?: string[];
}

export interface ExportSource {
  exportPage(q: ExportPageQuery): Promise<ExportPage>;
}
/** Kaynak istemcisi üreticisi; testler sahte kaynakla değiştirir. */
export type SourceClientFactory = (site: { baseUrl: string; token: string }) => ExportSource;
export const SOURCE_CLIENT_FACTORY = Symbol('SOURCE_CLIENT_FACTORY');

export class SyncBusyError extends Error {
  constructor(site: string) {
    super(`${site} için eşitleme zaten çalışıyor`);
    this.name = 'SyncBusyError';
  }
}

/** Delta aralığı (K42 ve F1 tamamlanma şartı: ≤ 10 dk) */
export const DELTA_INTERVAL_MS = 5 * 60_000;
/** Bu süreden eski "running" çalışma çökmüş sayılır */
const STALE_RUN_MS = 30 * 60_000;
/** Tam eşitleme bundan fazlasını "kaynakta yok" sayacaksa durur: boş/bozuk kaynak yanıtı aynayı silmesin */
const MAX_REMOVAL_RATIO = 0.5;
const MAX_PAGES = 1_000;
const MAX_DRIFT_IDS = 100;
/** Bir tikte yeniden çekilecek en çok süresi dolmuş fiyat */
const EXPIRY_BATCH = 50;

type SiteRow = NonNullable<Awaited<ReturnType<PrismaService['sourceSite']['findUnique']>>>;
type Outcome = 'created' | 'updated' | 'unchanged' | 'invalid';

/**
 * Kaynak site → katalog aynası eşitlemesi (K42). Her ürün kendi transaction'ında yazılır: katalog kaydı, kaynak
 * izi ve olay birlikte (K34). Değişmeyen ürün (content_hash aynı) yazılmaz, olay üretmez.
 */
@Injectable()
export class SourceSyncService {
  private readonly logger = new Logger('integration.sync');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogIngest,
    private readonly expiry: CatalogPriceExpiry,
    @Inject(SOURCE_CLIENT_FACTORY) private readonly clientFactory: SourceClientFactory,
  ) {}

  /**
   * Zamanı gelmiş siteler: aktif, token'lı, devresi kapalı. Hiç tam eşitlenmemiş ya da son gece uzlaştırma
   * saatinden beri tam eşitlenmemiş site "full", 5 dakikadır delta almamış site "delta" alır.
   */
  async dueSites(now = new Date()): Promise<{ code: string; kind: SyncKind }[]> {
    const sites = await this.prisma.sourceSite.findMany({
      where: { status: 'active', credentialsEnc: { not: null } },
      orderBy: { code: 'asc' },
    });
    const reconcileAt = lastReconcileAt(now);
    const due: { code: string; kind: SyncKind }[] = [];
    for (const s of sites) {
      if (isCircuitOpen(s.circuitOpenUntil, now)) continue;
      if (!s.lastFullSyncAt || s.lastFullSyncAt < reconcileAt) {
        due.push({ code: s.code, kind: 'full' });
      } else if (!s.lastDeltaSyncAt || now.getTime() - s.lastDeltaSyncAt.getTime() >= DELTA_INTERVAL_MS) {
        due.push({ code: s.code, kind: 'delta' });
      }
    }
    return due;
  }

  async run(siteCode: string, kind: SyncKind): Promise<SyncStats> {
    const site = await this.prisma.sourceSite.findUnique({ where: { code: siteCode } });
    if (!site) throw new Error(`Kaynak site bulunamadı: ${siteCode}`);
    if (!site.credentialsEnc) throw new Error(`${siteCode} için API token'ı girilmemiş`);

    const runId = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM integration.source_sites WHERE id = ${site.id}::uuid FOR UPDATE`;
      const running = await tx.syncRun.findFirst({
        where: { sourceSiteId: site.id, status: 'running', startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) } },
      });
      if (running) throw new SyncBusyError(siteCode);
      await tx.syncRun.updateMany({
        where: { sourceSiteId: site.id, status: 'running' },
        data: { status: 'failed', finishedAt: new Date(), error: 'yarıda kaldı (süreç durmuş olabilir)' },
      });
      await tx.syncRun.create({ data: { id: runId, sourceSiteId: site.id, kind, status: 'running', startedAt: new Date() } });
    });

    const stats: SyncStats = { pages: 0, fetched: 0, created: 0, updated: 0, unchanged: 0, removed: 0, invalid: 0, invalid_ids: [] };
    const drift: string[] = [];
    try {
      const client = this.client(site);
      const since = kind === 'delta' && site.watermark ? requestSince(site.watermark) : null;
      let watermark = site.watermark;
      const seen = new Set<string>();
      let cursor = 0;

      for (;;) {
        if (stats.pages >= MAX_PAGES) throw new Error(`Sayfa sınırı aşıldı (${MAX_PAGES})`);
        const page = await client.exportPage({ updatedSince: since, cursor, limit: EXPORT_PAGE_LIMIT });
        stats.pages++;
        const unchangedIds: string[] = [];
        for (const item of page.items) {
          stats.fetched++;
          const r = await this.processItem(site, item);
          if (r.externalId) seen.add(r.externalId);
          if (r.dateUpdated) watermark = maxWatermark(watermark, r.dateUpdated);
          stats[r.outcome]++;
          if (r.outcome === 'invalid' && stats.invalid_ids.length < 20) stats.invalid_ids.push(r.externalId ?? '?');
          if (r.outcome === 'unchanged') unchangedIds.push(r.externalId!);
          if ((r.outcome === 'created' || r.outcome === 'updated') && drift.length < MAX_DRIFT_IDS) drift.push(r.externalId!);
        }
        if (unchangedIds.length) {
          await this.prisma.sourceRecord.updateMany({
            where: { sourceSiteId: site.id, entity: 'product', externalId: { in: unchangedIds } },
            data: { lastSeenAt: new Date() },
          });
        }
        if (!page.hasMore) break;
        if (page.nextCursor <= cursor) throw new Error('Kaynak imleci ilerlemedi');
        cursor = page.nextCursor;
      }

      if (kind === 'full') {
        const removed = await this.removeMissing(site, seen);
        stats.removed = removed.length;
        // İlk tam eşitlemede her şey "created"dır; sapma ancak önceki bir tam eşitlemeden sonra anlamlıdır
        stats.drift_ids = site.lastFullSyncAt ? [...drift, ...removed].slice(0, MAX_DRIFT_IDS) : [];
      }

      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.sourceSite.update({
          where: { id: site.id },
          data: {
            watermark,
            ...(kind === 'full' ? { lastFullSyncAt: now, lastDeltaSyncAt: now } : { lastDeltaSyncAt: now }),
            consecutiveFailures: 0,
            circuitOpenUntil: null,
            lastError: null,
          },
        }),
        this.prisma.syncRun.update({ where: { id: runId }, data: { status: 'succeeded', finishedAt: now, stats: { ...stats } } }),
      ]);
      this.logger.log(`${site.code} ${kind}: ${JSON.stringify({ ...stats, invalid_ids: undefined, drift_ids: stats.drift_ids?.length })}`);
      return stats;
    } catch (error) {
      await this.recordFailure(site, error, runId, stats);
      throw error;
    }
  }

  /**
   * İndirimi biten ürünleri tekil yeniden çeker (K42: fiyat geçerlilik zamanlayıcısı). Kaynak bu anda
   * date_updated'i değiştirmez; delta yakalamaz. Devresi açık ya da token'sız sitenin ürünleri beklenir.
   */
  async refreshExpiredPrices(now = new Date()): Promise<{ checked: number; changed: number }> {
    const due = await this.expiry.findExpired(now, EXPIRY_BATCH);
    if (due.length === 0) return { checked: 0, changed: 0 };
    const sites = new Map(
      (await this.prisma.sourceSite.findMany({ where: { id: { in: [...new Set(due.map((d) => d.sourceSiteId))] } } })).map((s) => [s.id, s]),
    );
    let checked = 0;
    let changed = 0;
    for (const d of due) {
      const site = sites.get(d.sourceSiteId);
      if (!site?.credentialsEnc || site.status !== 'active' || isCircuitOpen(site.circuitOpenUntil, now)) continue;
      const id = Number(d.externalId);
      if (!Number.isInteger(id) || id < 1) continue;
      try {
        // Export'ta tekil uç yok: imleç "bu kimlikten büyük" demek, id-1 ve limit 1 tam o ürünü getirir
        const page = await this.client(site).exportPage({ cursor: id - 1, limit: 1 });
        const item = page.items[0];
        if (item && (item as { product_id?: unknown }).product_id === id) {
          const r = await this.processItem(site, item);
          if (r.outcome === 'created' || r.outcome === 'updated') changed++;
        }
        // Ürün değişmese ya da kaynakta artık olmasa da (arşiv: gece uzlaştırması işler) tekrar sorulmaz
        await this.prisma.$transaction((tx) => this.expiry.markChecked(tx, d.productId, now));
        checked++;
      } catch (e) {
        this.logger.warn(`${site.code} #${d.externalId} fiyat yenilemesi başarısız: ${(e as Error).message}`);
      }
    }
    if (checked) this.logger.log(`Süresi dolan fiyat: ${checked} ürün yeniden çekildi, ${changed} değişti`);
    return { checked, changed };
  }

  private client(site: SiteRow): ExportSource {
    return this.clientFactory({ baseUrl: site.baseUrl, token: decryptSecret(site.credentialsEnc!, loadEnv().SECRETS_KEY) });
  }

  /** Tek ürünü çözümler, değiştiyse katalog + kaynak izi + olayı aynı transaction'da yazar. */
  private async processItem(
    site: SiteRow,
    item: unknown,
  ): Promise<{ outcome: Outcome; externalId: string | null; dateUpdated: string | null }> {
    const parsed = EticaretProductSchema.safeParse(item);
    if (!parsed.success) return { outcome: 'invalid', externalId: rawId(item), dateUpdated: null };
    const product = toProductV1(parsed.data, site.code);
    const externalId = product.source.external_id;
    const dateUpdated = parsed.data.date_updated;
    const hash = productContentHash(product);
    const key = { sourceSiteId_entity_externalId: { sourceSiteId: site.id, entity: 'product', externalId } };

    const record = await this.prisma.sourceRecord.findUnique({ where: key });
    if (record && record.contentHash === hash && !record.deletedAtSource) return { outcome: 'unchanged', externalId, dateUpdated };

    const now = new Date();
    const actor = adapterActor(site.code);
    const { outcome } = await this.prisma.$transaction(async (tx) => {
      const result = await this.catalog.apply(tx, { storeId: site.storeId, sourceSiteId: site.id, product, contentHash: hash, actor, now });
      await tx.sourceRecord.upsert({
        where: key,
        create: {
          id: uuidv7(),
          sourceSiteId: site.id,
          entity: 'product',
          externalId,
          contentHash: hash,
          sourceUpdatedAt: dateUpdated,
          lastSeenAt: now,
        },
        update: { contentHash: hash, sourceUpdatedAt: dateUpdated, lastSeenAt: now, deletedAtSource: null },
      });
      return result;
    });
    return { outcome, externalId, dateUpdated };
  }

  /** Tam eşitlemede görülmeyen ürünler "kaynakta yok" olur (silinmez). İşaretlenen kimlikleri döner. */
  private async removeMissing(site: SiteRow, seen: Set<string>): Promise<string[]> {
    const live = await this.prisma.sourceRecord.findMany({
      where: { sourceSiteId: site.id, entity: 'product', deletedAtSource: null },
      select: { externalId: true },
    });
    const missing = live.filter((r) => !seen.has(r.externalId)).map((r) => r.externalId);
    if (missing.length === 0) return [];
    if (live.length >= 10 && missing.length / live.length > MAX_REMOVAL_RATIO) {
      throw new Error(
        `Tam eşitleme ${missing.length}/${live.length} ürünü kaynakta yok sayacaktı; güvenlik sınırı nedeniyle durduruldu`,
      );
    }
    const now = new Date();
    const actor = adapterActor(site.code);
    for (const externalId of missing) {
      await this.prisma.$transaction(async (tx) => {
        await this.catalog.markRemoved(tx, site.id, externalId, actor);
        await tx.sourceRecord.update({
          where: { sourceSiteId_entity_externalId: { sourceSiteId: site.id, entity: 'product', externalId } },
          data: { deletedAtSource: now },
        });
      });
    }
    return missing;
  }

  private async recordFailure(site: SiteRow, error: unknown, runId: string, stats: SyncStats): Promise<void> {
    const now = new Date();
    const message = error instanceof Error ? error.message : String(error);
    const circuit = nextCircuitState(site.consecutiveFailures, now);
    await this.prisma.$transaction([
      this.prisma.sourceSite.update({ where: { id: site.id }, data: { ...circuit, lastError: message } }),
      this.prisma.syncRun.update({
        where: { id: runId },
        data: { status: 'failed', finishedAt: now, stats: { ...stats }, error: message },
      }),
    ]);
  }
}

function adapterActor(siteCode: string): Actor {
  return { type: 'adapter', id: `eticaret_legacy:${siteCode}` };
}

function rawId(item: unknown): string | null {
  const id = (item as { product_id?: unknown } | null)?.product_id;
  return typeof id === 'number' && Number.isInteger(id) ? String(id) : null;
}
