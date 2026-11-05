import { describe, expect, it } from 'vitest';
import { EventEnvelopeSchema, UUID_RE, uuidv7, uuidv7Time } from '../src/index.js';

describe('uuidv7 (K33)', () => {
  it('geçerli v7 kimliği üretir ve zamanı taşır', () => {
    const now = Date.UTC(2026, 10, 5, 12, 0, 0);
    const id = uuidv7(now);
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
    expect(uuidv7Time(id)).toBe(now);
  });

  it('zamana göre sıralanır', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a < b).toBe(true);
  });
});

describe('olay zarfı (K50)', () => {
  const base = {
    id: uuidv7(),
    type: 'catalog.price.changed',
    version: 1,
    occurred_at: new Date().toISOString(),
    source_module: 'catalog',
    aggregate: { type: 'product', id: uuidv7() },
    correlation_id: null,
    causation_id: null,
    actor: { type: 'adapter', id: 'esensolarmarket' },
    data: { final_minor: '1249900' },
  };

  it('geçerli zarfı kabul eder', () => {
    expect(EventEnvelopeSchema.parse(base).type).toBe('catalog.price.changed');
  });

  it('biçimsiz olay türünü reddeder', () => {
    expect(() => EventEnvelopeSchema.parse({ ...base, type: 'PriceChanged' })).toThrow();
  });
});
