import { Injectable } from '@nestjs/common';
import { SYSTEM_ACTOR } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { OutboxWriter } from '../../platform/public/index.js';

export interface Alert {
  /** Kısıtlama anahtarı: aynı anahtar saatte en çok bir kez gönderilir (örn. error:<parmak izi>, backup:failed) */
  key: string;
  subject: string;
  text: string;
}

export const ALERT_EVENT = 'ops.alert.raised';

/**
 * Uyarı üretir. Uyarı outbox'a yazılır (K34); worker'daki e-posta tüketicisi gönderir. Böylece e-posta servisi
 * geçici olarak yoksa uyarı kaybolmaz, yeniden denenir.
 */
@Injectable()
export class AlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxWriter,
  ) {}

  async raise(alert: Alert): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.outbox.append(tx, {
        type: ALERT_EVENT,
        sourceModule: 'ops',
        aggregate: { type: 'alert', id: alert.key },
        actor: SYSTEM_ACTOR,
        data: { ...alert },
      }),
    );
  }
}
