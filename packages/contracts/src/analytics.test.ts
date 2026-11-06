import { describe, expect, it } from 'vitest';
import { AnalyticsBatchSchema, decodeConsent, encodeConsent } from './analytics.js';

const SID = '01934f2a-7b3c-7d4e-8f50-123456789abc';
const PID = '01934f2a-7b3c-7d4e-8f50-0000000000aa';

describe('olay sözlüğü', () => {
  it('bilinen olay ve geçerli alanlar kabul edilir', () => {
    const r = AnalyticsBatchSchema.safeParse({
      session_id: SID,
      events: [
        { name: 'page_view', props: { path: '/sehir' } },
        { name: 'product_view', props: { product_id: PID, surface: '3d' } },
        { name: 'search', props: { q: '  inverter ', results: 4 } },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data?.events[2]?.props).toEqual({ q: 'inverter', results: 4 });
  });

  it('bilinmeyen olay, eksik alan ve fazla olay reddedilir', () => {
    expect(AnalyticsBatchSchema.safeParse({ session_id: SID, events: [{ name: 'login', props: {} }] }).success).toBe(false);
    expect(AnalyticsBatchSchema.safeParse({ session_id: SID, events: [{ name: 'product_view', props: { surface: '2d' } }] }).success).toBe(false);
    const many = Array.from({ length: 21 }, () => ({ name: 'page_view', props: { path: '/' } }));
    expect(AnalyticsBatchSchema.safeParse({ session_id: SID, events: many }).success).toBe(false);
  });

  it('şemada olmayan alan (ör. e-posta) atılır', () => {
    const r = AnalyticsBatchSchema.parse({ session_id: SID, events: [{ name: 'page_view', props: { path: '/', email: 'a@b.c' } }] });
    expect(r.events[0]?.props).toEqual({ path: '/' });
  });
});

describe('rıza çerezi', () => {
  const now = new Date('2026-11-06T10:00:00Z');

  it('kodla/çöz', () => {
    const c = { analytics: true, ga4: false, decidedAt: '20261106' };
    expect(encodeConsent(c)).toBe('v1.1.0.20261106');
    expect(decodeConsent('v1.1.0.20261106', now)).toEqual(c);
    expect(decodeConsent(encodeConsent({ ...c, ga4: null }), now)?.ga4).toBeNull();
  });

  it('geçersiz ya da 180 günden eski karar yeniden sorulur', () => {
    expect(decodeConsent(undefined, now)).toBeNull();
    expect(decodeConsent('v1.1.1', now)).toBeNull();
    expect(decodeConsent('v2.1.1.20261106', now)).toBeNull();
    expect(decodeConsent('v1.1.1.20260401', now)).toBeNull();
    expect(decodeConsent('v1.0.0.20260601', now)).not.toBeNull();
  });
});
