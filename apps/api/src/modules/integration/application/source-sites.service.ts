import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { loadEnv } from '../../../infra/config/env.js';
import { encryptSecret } from '../../../infra/crypto/secrets.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { type AdminContext, notFound } from '../../../infra/http/admin-request.js';
import { AuditWriter } from '../../audit/public/index.js';
import { StoresService } from '../../commerce/public/index.js';
import { ETICARET_SYSTEM } from '../domain/eticaret/to-product-v1.js';

export interface SourceSiteSeed {
  code: string;
  baseUrl: string;
  companyDisplayName: string;
  storeName: string;
}

/** Pilot siteler (mevcut-altyapi, ticari-yapi). solarbank'ın firma adı yönetim panelinden düzeltilecek (A2). */
export const PILOT_SITES: SourceSiteSeed[] = [
  { code: 'esensolarmarket', baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen Solar Market', storeName: 'Esen Solar Market' },
  { code: 'ankaragrupsolar', baseUrl: 'https://ankaragrupsolar.com', companyDisplayName: 'Ankara Grup Solar', storeName: 'Ankara Grup Solar' },
  { code: 'solarbank', baseUrl: 'https://solarbank.com.tr', companyDisplayName: 'Solarbank', storeName: 'Solarbank' },
  { code: 'denemekapsulu', baseUrl: 'https://denemekapsulu.com', companyDisplayName: 'Deneme Kapsülü', storeName: 'Deneme Kapsülü' },
  { code: 'netdenemekulubu', baseUrl: 'https://netdenemekulubu.com', companyDisplayName: 'Net Deneme Kulübü', storeName: 'Net Deneme Kulübü' },
];

const CODE_RE = /^[a-z0-9_]{2,40}$/;

/** Kaynak site kaydı ve sırrı. Yönetim ekranı F1.3; şimdilik CLI (scripts/sources.ts) kullanır. */
@Injectable()
export class SourceSitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly audit: AuditWriter,
  ) {}

  /** Siteyi, firmasını ve mağazasını yoksa açar. Tekrar çağrılabilir. */
  async register(seed: SourceSiteSeed): Promise<{ siteId: string; created: boolean }> {
    if (!CODE_RE.test(seed.code)) throw new Error(`Geçersiz site kodu: ${seed.code}`);
    const base = new URL(seed.baseUrl);
    if (base.protocol !== 'https:' && loadEnv().NODE_ENV === 'production') throw new Error('Kaynak adresi https olmalı');

    return this.prisma.$transaction(async (tx) => {
      const system = await tx.sourceSystem.upsert({
        where: { code: ETICARET_SYSTEM },
        create: {
          id: uuidv7(),
          code: ETICARET_SYSTEM,
          name: 'eticaret (PHP/MariaDB)',
          adapter: 'eticaret',
          contractVersion: 'commerce.product.v1',
          capabilities: { delta_export: true, webhook: false, orders: false, account_link: false },
        },
        update: {},
      });
      const existing = await tx.sourceSite.findUnique({ where: { code: seed.code } });
      if (existing) return { siteId: existing.id, created: false };
      const { storeId } = await this.stores.ensureStore(tx, {
        slug: seed.code.replace(/_/g, '-'),
        storeName: seed.storeName,
        companyDisplayName: seed.companyDisplayName,
        website: base.origin,
      });
      const siteId = uuidv7();
      await tx.sourceSite.create({
        data: { id: siteId, sourceSystemId: system.id, code: seed.code, baseUrl: base.origin, storeId },
      });
      await this.stores.linkSource(tx, storeId, siteId);
      return { siteId, created: true };
    });
  }

  /**
   * API token'ını şifreli saklar (products.public_read). Değer geri okunamaz, yalnız değiştirilir; denetim
   * kaydına token değil yalnız "değişti" yazılır. ctx yoksa (CLI) aktör sistemdir.
   */
  async setToken(code: string, token: string, ctx?: AdminContext): Promise<void> {
    const value = token.trim();
    if (value.length < 20) throw new Error('Token çok kısa görünüyor');
    await this.prisma.$transaction(async (tx) => {
      const site = await tx.sourceSite.findUnique({ where: { code } });
      if (!site) throw notFound('Kaynak site bulunamadı.');
      await tx.sourceSite.update({
        where: { code },
        data: {
          credentialsEnc: encryptSecret(value, loadEnv().SECRETS_KEY),
          // Yeni token'la devre yeniden denensin
          consecutiveFailures: 0,
          circuitOpenUntil: null,
          lastError: null,
          version: { increment: 1 },
        },
      });
      await this.audit.write(tx, {
        actor: ctx?.actor ?? { type: 'system', id: 'cli' },
        action: 'integration.source_site.token_changed',
        entity: { type: 'source_site', id: site.id },
        diff: { had_token: site.credentialsEnc !== null },
        requestId: ctx?.requestId ?? null,
        ipHash: ctx?.ipHash ?? null,
      });
    });
  }

  /**
   * Elle eşitleme isteği: worker bir sonraki tikte (≤ 60 sn) çalıştırır. HTTP isteği tam eşitlemeyi beklemez;
   * zaman damgası sıfırlanınca dueSites siteyi seçer. Devre de kapatılır (yönetici yeniden denemek istiyor).
   */
  async requestSync(code: string, kind: 'full' | 'delta', ctx: AdminContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const site = await tx.sourceSite.findUnique({ where: { code } });
      if (!site) throw notFound('Kaynak site bulunamadı.');
      await tx.sourceSite.update({
        where: { code },
        data: { ...(kind === 'full' ? { lastFullSyncAt: null } : { lastDeltaSyncAt: null }), circuitOpenUntil: null },
      });
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'integration.source_site.sync_requested',
        entity: { type: 'source_site', id: site.id },
        diff: { kind },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
    });
  }

  /** Siteyi durdurur / devam ettirir: durdurulan siteye istek gitmez, ayna olduğu gibi kalır. */
  async setStatus(code: string, status: 'active' | 'paused', ctx: AdminContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const site = await tx.sourceSite.findUnique({ where: { code } });
      if (!site) throw notFound('Kaynak site bulunamadı.');
      if (site.status === status) return;
      await tx.sourceSite.update({ where: { code }, data: { status, version: { increment: 1 } } });
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: status === 'paused' ? 'integration.source_site.paused' : 'integration.source_site.resumed',
        entity: { type: 'source_site', id: site.id },
        diff: { status: { from: site.status, to: status } },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
    });
  }

  async runs(code: string, limit: number) {
    const site = await this.prisma.sourceSite.findUnique({ where: { code } });
    if (!site) throw notFound('Kaynak site bulunamadı.');
    const rows = await this.prisma.syncRun.findMany({ where: { sourceSiteId: site.id }, orderBy: { startedAt: 'desc' }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      stats: r.stats,
      error: r.error,
    }));
  }

  async list() {
    const sites = await this.prisma.sourceSite.findMany({
      orderBy: { code: 'asc' },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    return sites.map((s) => ({
      id: s.id,
      storeId: s.storeId,
      code: s.code,
      baseUrl: s.baseUrl,
      status: s.status,
      hasToken: s.credentialsEnc !== null,
      hasWebhookSecret: s.webhookSecretEnc !== null,
      lastWebhookAt: s.lastWebhookAt,
      watermark: s.watermark,
      lastFullSyncAt: s.lastFullSyncAt,
      lastDeltaSyncAt: s.lastDeltaSyncAt,
      consecutiveFailures: s.consecutiveFailures,
      circuitOpenUntil: s.circuitOpenUntil,
      lastError: s.lastError,
      lastRun: s.runs[0] ? { kind: s.runs[0].kind, status: s.runs[0].status, startedAt: s.runs[0].startedAt, stats: s.runs[0].stats } : null,
    }));
  }

  /** Art arda hata veren siteler (worker uyarıya çevirir; integration ops'a bağımlı olamaz, K51). */
  async failing(minFailures: number) {
    return this.prisma.sourceSite.findMany({
      where: { consecutiveFailures: { gte: minFailures } },
      select: { code: true, consecutiveFailures: true, lastError: true, circuitOpenUntil: true },
    });
  }
}
