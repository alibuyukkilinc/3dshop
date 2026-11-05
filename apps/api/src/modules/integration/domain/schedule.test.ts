import { describe, expect, it } from 'vitest';
import { lastReconcileAt } from './schedule.js';

describe('gece uzlaştırma saati (Türkiye 04:30, UTC+3)', () => {
  it('04:30 öncesinde dünkü, sonrasında bugünkü anı verir', () => {
    expect(lastReconcileAt(new Date('2026-11-06T01:29:59Z')).toISOString()).toBe('2026-11-05T01:30:00.000Z');
    expect(lastReconcileAt(new Date('2026-11-06T01:30:00Z')).toISOString()).toBe('2026-11-06T01:30:00.000Z');
    expect(lastReconcileAt(new Date('2026-11-06T22:00:00Z')).toISOString()).toBe('2026-11-06T01:30:00.000Z');
  });
  it('Türkiye gece yarısını (UTC 21:00) doğru güne bağlar', () => {
    expect(lastReconcileAt(new Date('2026-12-31T21:30:00Z')).toISOString()).toBe('2026-12-31T01:30:00.000Z');
  });
});
