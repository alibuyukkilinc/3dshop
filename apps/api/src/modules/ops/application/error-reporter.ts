import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../../infra/config/env.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { fingerprint } from '../domain/fingerprint.js';
import { AlertService } from './alert.service.js';

export type ErrorSource = 'api' | 'worker' | 'web' | 'job';

export interface ErrorContext {
  method?: string;
  path?: string;
  requestId?: string | null;
  eventType?: string;
  [key: string]: unknown;
}

/**
 * Kendi hata kaydımız (F0.7): beklenmeyen hatalar ops.error_events'e parmak iziyle sayılır. Yeni bir hata türü
 * ya da çözüldü işaretlendikten sonra tekrarlayan hata uyarı üretir. Kişisel veri yazılmaz (yalnız yol, yöntem,
 * istek kimliği). Bu servis asla hata fırlatmaz: hata kaydı başarısız olursa yalnız günlüğe yazar.
 */
@Injectable()
export class ErrorReporter {
  private readonly logger = new Logger('errors');

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
  ) {}

  async report(error: unknown, source: ErrorSource, context: ErrorContext = {}): Promise<string | null> {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`${source}: ${err.name}: ${err.message}`, err.stack);
    try {
      const fp = fingerprint(source, err.name, err.message, err.stack);
      const rows = await this.prisma.$queryRaw<{ inserted: boolean; was_resolved: boolean }[]>`
        WITH prev AS (SELECT resolved_at FROM ops.error_events WHERE fingerprint = ${fp})
        INSERT INTO ops.error_events (fingerprint, source, name, message, stack, last_context)
        VALUES (${fp}, ${source}, ${err.name.slice(0, 200)}, ${err.message.slice(0, 2000)},
                ${err.stack?.slice(0, 8000) ?? null}, ${JSON.stringify(context)}::jsonb)
        ON CONFLICT (fingerprint) DO UPDATE SET
          count = ops.error_events.count + 1,
          last_seen_at = now(),
          message = EXCLUDED.message,
          stack = EXCLUDED.stack,
          last_context = EXCLUDED.last_context,
          resolved_at = NULL,
          resolved_by = NULL
        RETURNING (xmax = 0) AS inserted, ((SELECT resolved_at FROM prev) IS NOT NULL) AS was_resolved`;
      const row = rows[0];
      if (row && (row.inserted || row.was_resolved)) {
        const env = loadEnv();
        await this.alerts.raise({
          key: `error:${fp}`,
          subject: `[${env.ENV_LABEL}] ${row.inserted ? 'Yeni hata' : 'Hata tekrarladı'}: ${err.name}`,
          text: [
            `Kaynak: ${source}`,
            `Hata: ${err.name}: ${err.message}`,
            context.path ? `İstek: ${context.method ?? ''} ${context.path}` : null,
            context.eventType ? `Olay: ${context.eventType}` : null,
            `Parmak izi: ${fp}`,
            '',
            (err.stack ?? '').split('\n').slice(0, 8).join('\n'),
            '',
            'Yönetim paneli → Sistem durumu',
          ]
            .filter((l) => l !== null)
            .join('\n'),
        });
      }
      return fp;
    } catch (inner) {
      this.logger.error(`Hata kaydı yazılamadı: ${(inner as Error).message}`);
      return null;
    }
  }
}
