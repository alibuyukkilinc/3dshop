import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { loadEnv } from '../../../infra/config/env.js';
import { encryptSecret } from '../../../infra/crypto/secrets.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
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

  /** API token'ını şifreli saklar (products.public_read). Değer geri okunamaz, yalnız değiştirilir. */
  async setToken(code: string, token: string): Promise<void> {
    const value = token.trim();
    if (value.length < 20) throw new Error('Token çok kısa görünüyor');
    await this.prisma.sourceSite.update({
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
  }

  async list() {
    const sites = await this.prisma.sourceSite.findMany({
      orderBy: { code: 'asc' },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    return sites.map((s) => ({
      code: s.code,
      baseUrl: s.baseUrl,
      status: s.status,
      hasToken: s.credentialsEnc !== null,
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
