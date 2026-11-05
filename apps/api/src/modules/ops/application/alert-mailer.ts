import { Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@dtd/contracts';
import { loadEnv } from '../../../infra/config/env.js';
import type { Tx } from '../../../infra/db/types.js';
import type { EventHandler } from '../../platform/public/index.js';
import { MailSender } from '../infrastructure/mail-sender.js';
import { ALERT_EVENT, type Alert } from './alert.service.js';

export const ALERT_THROTTLE_MS = 60 * 60_000;

/** Worker tüketicisi: uyarıyı e-postayla gönderir; aynı anahtar saatte en çok bir kez. */
@Injectable()
export class AlertMailer implements EventHandler {
  readonly name = 'ops.alert_mailer';
  readonly types = [ALERT_EVENT];

  constructor(private readonly mail: MailSender) {}

  async handle(event: EventEnvelope, tx: Tx, now = new Date()): Promise<void> {
    const alert = event.data as unknown as Alert;
    const state = await tx.alertState.findUnique({ where: { key: alert.key } });
    if (state && now.getTime() - state.lastSentAt.getTime() < ALERT_THROTTLE_MS) return;
    await this.mail.send({ to: loadEnv().ALERT_EMAIL_TO, subject: alert.subject, text: alert.text });
    await tx.alertState.upsert({
      where: { key: alert.key },
      create: { key: alert.key, lastSentAt: now },
      update: { lastSentAt: now, sentCount: { increment: 1 } },
    });
  }
}
