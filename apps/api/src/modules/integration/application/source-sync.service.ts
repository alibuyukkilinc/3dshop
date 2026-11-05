import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Actor, uuidv7 } from '@dtd/contracts';
import { loadEnv } from '../../../infra/config/env.js';
import { decryptSecret } from '../../../infra/crypto/secrets.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { CatalogIngest } from '../../catalog/public/index.js';
import { isCircuitOpen, nextCircuitState } from '../domain/circuit.js';
import { productContentHash } from '../domain/content-hash.js';
import { EticaretProductSchema } from '../domain/eticaret/export-schema.js';
import { toProductV1 } from '../domain/eticaret/to-product-v1.js';
import { maxWatermark, requestSince } from '../domain/watermark.js';
import { EXPORT_PAGE_LIMIT, type ExportPage, type ExportPageQuery } from '../infrastructure/eticaret-client.js';

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

/** Tam eşitleme aralığı (gece uzlaştırması F1.2'de ayrıca gelir) ve delta aralığı (K42: ≤ 10 dk hedef) */
export const FULL_INTERVAL_MS = 24 * 3_600_000;
export const DELTA_INTERVAL_MS = 5 * 60_000;
/** Bu süreden eski "running" çalışma çökmüş sayılır */
const STALE_RUN_MS = 30 * 60_000;
/** Tam eşitleme bundan fazlasını "kaynakta yok" sayacaksa durur: boş/bozuk kaynak yanıtı aynayı silmesin */
const MAX_REMOVAL_RATIO = 0.5;
const MAX_PAGES = 1_000;

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
    @Inject(SOURCE_CLIENT_FACTORY) private readonly clientFactory: SourceClientFactory,
  ) {}

  /** Zamanı gelmiş siteler: aktif, token'lı, devresi kapalı. */
  async dueSites(now = new Date()): Promise<{ code: string; kind: SyncKind }[]> {
    const sites = await this.prisma.sourceSite.findMany({
      where: { status: 'active', credentialsEnc: { not: null } },
      orderBy: { code: 'asc' },
    });
    const due: { code: string; kind: SyncKind }[] = [];
    for (const s of sites) {
      if (isCircuitOpen(s.circuitOpenUntil, now)) continue;
      if (!s.lastFullSyncAt || now.getTime() - s.lastFullSyncAt.getTime() >= FULL_INTERVAL_MS) {
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
    const actor: Actor = { type: 'adapter', id: `eticaret_legacy:${site.code}` };
    try {
      const client = this.clientFactory({ baseUrl: site.baseUrl, token: decryptSecret(site.credentialsEnc, loadEnv().SECRETS_KEY) });
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
          const parsed = EticaretProductSchema.safeParse(item);
          if (!parsed.success) {
            const id = rawId(item);
            if (id) seen.add(id);
            stats.invalid++;
            if (stats.invalid_ids.length < 20) stats.invalid_ids.push(id ?? '?');
            continue;
          }
          const product = toProductV1(parsed.data, site.code);
          const externalId = product.source.external_id;
          seen.add(externalId);
          watermark = maxWatermark(watermark, parsed.data.date_updated);
          const hash = productContentHash(product);

          const record = await this.prisma.sourceRecord.findUnique({
            where: { sourceSiteId_entity_externalId: { sourceSiteId: site.id, entity: 'product', externalId } },
          });
          if (record && record.contentHash === hash && !record.deletedAtSource) {
            stats.unchanged++;
            unchangedIds.push(externalId);
            continue;
          }
          const now = new Date();
          const { outcome } = await this.prisma.$transaction(async (tx) => {
            const result = await this.catalog.apply(tx, {
              storeId: site.storeId,
              sourceSiteId: site.id,
              product,
              contentHash: hash,
              actor,
              now,
            });
            await tx.sourceRecord.upsert({
              where: { sourceSiteId_entity_externalId: { sourceSiteId: site.id, entity: 'product', externalId } },
              create: {
                id: uuidv7(),
                sourceSiteId: site.id,
                entity: 'product',
                externalId,
                contentHash: hash,
                sourceUpdatedAt: product.source.updated_at,
                lastSeenAt: now,
              },
              update: { contentHash: hash, sourceUpdatedAt: product.source.updated_at, lastSeenAt: now, deletedAtSource: null },
            });
            return result;
          });
          stats[outcome]++;
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

      if (kind === 'full') stats.removed = await this.removeMissing(site.id, seen, actor);

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
      this.logger.log(`${site.code} ${kind}: ${JSON.stringify({ ...stats, invalid_ids: undefined })}`);
      return stats;
    } catch (error) {
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
      throw error;
    }
  }

  /** Tam eşitlemede görülmeyen ürünler "kaynakta yok" olur (silinmez). */
  private async removeMissing(sourceSiteId: string, seen: Set<string>, actor: Actor): Promise<number> {
    const live = await this.prisma.sourceRecord.findMany({
      where: { sourceSiteId, entity: 'product', deletedAtSource: null },
      select: { externalId: true },
    });
    const missing = live.filter((r) => !seen.has(r.externalId)).map((r) => r.externalId);
    if (missing.length === 0) return 0;
    if (live.length >= 10 && missing.length / live.length > MAX_REMOVAL_RATIO) {
      throw new Error(
        `Tam eşitleme ${missing.length}/${live.length} ürünü kaynakta yok sayacaktı; güvenlik sınırı nedeniyle durduruldu`,
      );
    }
    const now = new Date();
    for (const externalId of missing) {
      await this.prisma.$transaction(async (tx) => {
        await this.catalog.markRemoved(tx, sourceSiteId, externalId, actor);
        await tx.sourceRecord.update({
          where: { sourceSiteId_entity_externalId: { sourceSiteId, entity: 'product', externalId } },
          data: { deletedAtSource: now },
        });
      });
    }
    return missing.length;
  }
}

function rawId(item: unknown): string | null {
  const id = (item as { product_id?: unknown } | null)?.product_id;
  return typeof id === 'number' && Number.isInteger(id) ? String(id) : null;
}
