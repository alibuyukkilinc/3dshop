import { z } from 'zod';

/**
 * Olay zarfı (K50). Tüm modül olayları bu biçimde outbox'a (K34) yazılır.
 * type: <modül>.<varlık>.<eylem>, örn. catalog.price.changed. Kırıcı değişiklik yeni version ile yapılır.
 */
export const EventTypeSchema = z
  .string()
  .regex(/^[a-z]+\.[a-z_]+\.[a-z_]+$/, 'olay türü <modül>.<varlık>.<eylem> biçiminde olmalı');

export const ActorSchema = z.object({
  type: z.enum(['admin', 'system', 'adapter', 'ai', 'guest', 'user']),
  id: z.string().min(1),
});
export type Actor = z.infer<typeof ActorSchema>;

export const EventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: EventTypeSchema,
  version: z.number().int().positive(),
  occurred_at: z.iso.datetime(),
  source_module: z.string().min(1),
  aggregate: z.object({ type: z.string().min(1), id: z.string().min(1) }),
  correlation_id: z.string().nullable(),
  causation_id: z.string().nullable(),
  actor: ActorSchema,
  data: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const SYSTEM_ACTOR: Actor = { type: 'system', id: 'system' };
