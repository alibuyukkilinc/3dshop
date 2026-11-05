import { Injectable } from '@nestjs/common';
import { type Actor, type EventEnvelope, EventEnvelopeSchema, uuidv7 } from '@dtd/contracts';
import type { Tx } from '../../../infra/db/types.js';

export interface NewEvent {
  type: string;
  version?: number;
  sourceModule: string;
  aggregate: { type: string; id: string };
  actor: Actor;
  data: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
}

/**
 * Transactional outbox (K34, K50): olay, iş verisiyle AYNI transaction'da yazılır.
 * Transaction geri alınırsa olay da yoktur; commit olursa worker teslim eder.
 */
@Injectable()
export class OutboxWriter {
  async append(tx: Tx, event: NewEvent): Promise<EventEnvelope> {
    const envelope = EventEnvelopeSchema.parse({
      id: uuidv7(),
      type: event.type,
      version: event.version ?? 1,
      occurred_at: new Date().toISOString(),
      source_module: event.sourceModule,
      aggregate: event.aggregate,
      correlation_id: event.correlationId ?? null,
      causation_id: event.causationId ?? null,
      actor: event.actor,
      data: event.data,
    });
    await tx.outboxEvent.create({
      data: {
        id: envelope.id,
        module: envelope.source_module,
        eventType: envelope.type,
        version: envelope.version,
        aggregateType: envelope.aggregate.type,
        aggregateId: envelope.aggregate.id,
        payload: envelope as never,
        occurredAt: new Date(envelope.occurred_at),
      },
    });
    return envelope;
  }
}
