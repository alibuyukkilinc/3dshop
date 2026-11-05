import { describe, expect, it } from 'vitest';
import { BASE_OPEN_MS, MAX_OPEN_MS, isCircuitOpen, nextCircuitState } from './circuit.js';
import { maxWatermark, requestSince } from './watermark.js';

describe('filigran (K42)', () => {
  it('yalnız ileri gider ve kaynak biçimini korur', () => {
    expect(maxWatermark(null, '2026-11-05 10:00:00')).toBe('2026-11-05 10:00:00');
    expect(maxWatermark('2026-11-05 10:00:00', '2026-11-04 23:59:59')).toBe('2026-11-05 10:00:00');
    expect(maxWatermark('2026-11-05 10:00:00', '0000-00-00')).toBe('2026-11-05 10:00:00');
  });
  it('isteği örtüşmeyle geri alır; gün ve yıl sınırını geçer', () => {
    expect(requestSince('2026-11-05 10:01:00')).toBe('2026-11-05 09:59:00');
    expect(requestSince('2027-01-01 00:00:30')).toBe('2026-12-31 23:58:30');
  });
});

describe('devre kesici', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  it('üçüncü hatada açılır, bekleme katlanır ve sınırlanır', () => {
    expect(nextCircuitState(0, now).circuitOpenUntil).toBeNull();
    expect(nextCircuitState(2, now).circuitOpenUntil!.getTime() - now.getTime()).toBe(BASE_OPEN_MS);
    expect(nextCircuitState(3, now).circuitOpenUntil!.getTime() - now.getTime()).toBe(2 * BASE_OPEN_MS);
    expect(nextCircuitState(50, now).circuitOpenUntil!.getTime() - now.getTime()).toBe(MAX_OPEN_MS);
    expect(isCircuitOpen(new Date(now.getTime() + 1), now)).toBe(true);
    expect(isCircuitOpen(null, now)).toBe(false);
  });
});
