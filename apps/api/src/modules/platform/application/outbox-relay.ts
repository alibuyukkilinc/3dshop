import { Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';

/** Bir olay tüketicisi. name, inbox'ta tekrar işleme korumasının anahtarıdır; değiştirilmemeli. */
export interface EventHandler {
  name: string;
  /** Dinlediği olay türleri (tam ad) */
  types: string[];
  handle(event: EventEnvelope, tx: Tx): Promise<void>;
}

export const MAX_ATTEMPTS = 5;

/** Üstel geri çekilme: 5 sn, 25 sn, ~2 dk, ~10 dk (K51). */
export function backoffMs(attempt: number): number {
  return 5_000 * 5 ** Math.max(0, attempt - 1);
}

/**
 * Outbox'taki olayları kayıtlı tüketicilere iletir (worker). Her tüketici kendi transaction'ında çalışır ve
 * inbox'a yazar: aynı olay ikinci kez gelirse atlanır. Bir tüketici hata verirse olay yeniden denenir;
 * MAX_ATTEMPTS sonunda dead (ölü mektup) olur ve yönetici panelinde görünür.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly handlers: EventHandler[] = [];

  constructor(private readonly prisma: PrismaService) {}

  register(handler: EventHandler): void {
    if (this.handlers.some((h) => h.name === handler.name)) {
      throw new Error(`Aynı adla iki tüketici kaydedilemez: ${handler.name}`);
    }
    this.handlers.push(handler);
  }

  /** Teslim zamanı gelmiş en çok `limit` olayı işler; işlenen olay sayısını döner. */
  async runOnce(limit = 50, now: Date = new Date()): Promise<number> {
    const due = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null, dead: false, nextAttemptAt: { lte: now } },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    });
    for (const row of due) {
      const event = row.payload as unknown as EventEnvelope;
      const failures: string[] = [];
      for (const handler of this.handlers.filter((h) => h.types.includes(event.type))) {
        try {
          await this.prisma.$transaction(async (tx) => {
            const done = await tx.inboxEntry.findUnique({
              where: { consumer_eventId: { consumer: handler.name, eventId: event.id } },
            });
            if (done) return;
            await handler.handle(event, tx);
            await tx.inboxEntry.create({ data: { consumer: handler.name, eventId: event.id } });
          });
        } catch (error) {
          failures.push(`${handler.name}: ${(error as Error).message}`.slice(0, 500));
        }
      }
      if (failures.length === 0) {
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), lastError: null },
        });
        continue;
      }
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      if (dead) this.logger.error(`Olay ölü mektuba düştü: ${event.type} ${event.id} — ${failures.join(' | ')}`);
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          attempts,
          dead,
          lastError: failures.join(' | ').slice(0, 2000),
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
        },
      });
    }
    return due.length;
  }
}
