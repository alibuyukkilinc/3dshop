import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../../infra/config/env.js';

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

/**
 * Resend HTTP API ile e-posta (Cortex'teki gibi). RESEND_API_KEY yoksa e-posta gönderilmez, günlüğe yazılır.
 * Gönderim hatası fırlatılır: outbox tüketicisi yeniden dener.
 */
@Injectable()
export class MailSender {
  private readonly logger = new Logger(MailSender.name);

  async send(mail: Mail): Promise<'sent' | 'skipped'> {
    const env = loadEnv();
    if (!env.RESEND_API_KEY || mail.to.length === 0) {
      this.logger.warn(`E-posta gönderilmedi (RESEND_API_KEY ya da alıcı yok): ${mail.subject}`);
      return 'skipped';
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resend ${res.status}: ${body}`);
    }
    return 'sent';
  }
}
