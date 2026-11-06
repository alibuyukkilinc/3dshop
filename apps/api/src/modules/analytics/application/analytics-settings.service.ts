import { Injectable } from '@nestjs/common';
import { GA4_ID_RE } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { AdminContext } from '../../../infra/http/admin-request.js';
import { AuditWriter } from '../../audit/public/index.js';
import { SettingsService } from '../../platform/public/index.js';

const GA4_KEY = 'analytics.ga4';

export interface Ga4Setting {
  /** Platformun kendi GA4 mülkü (G-XXXX). null = GA4 kapalı: rıza verilse de Google'a hiçbir şey gitmez. */
  measurement_id: string | null;
}

/**
 * GA4 ayarı (K15, K07 merkezi ayar). Ölçüm kimliği sır değildir (sayfada görünür); API secret gerekmez çünkü
 * gönderim tarayıcıdan, yalnız açık rızayla yapılır. Değişiklik denetim kaydına yazılır (K47).
 */
@Injectable()
export class AnalyticsSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditWriter,
  ) {}

  async ga4(): Promise<Ga4Setting> {
    const v = await this.settings.get<Partial<Ga4Setting> | null>(GA4_KEY, null);
    const id = v?.measurement_id ?? null;
    return { measurement_id: id && GA4_ID_RE.test(id) ? id : null };
  }

  async setGa4(next: Ga4Setting, ctx: AdminContext): Promise<Ga4Setting> {
    const before = await this.ga4();
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(GA4_KEY, next, ctx.actor.id, tx);
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'analytics.ga4.updated',
        entity: { type: 'setting', id: GA4_KEY },
        diff: { measurement_id: next.measurement_id, previous: before.measurement_id },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
    });
    return next;
  }
}
