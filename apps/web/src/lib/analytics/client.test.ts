import { describe, expect, it } from 'vitest';
import { needsDecision, outboundFromHref } from './client';

describe('analitik istemcisi', () => {
  it('rıza kararı: hiç yoksa ya da GA4 sonradan açıldıysa sorulur', () => {
    expect(needsDecision(null, false)).toBe(true);
    expect(needsDecision({ analytics: false, ga4: null, decidedAt: '20261106' }, false)).toBe(false);
    expect(needsDecision({ analytics: true, ga4: null, decidedAt: '20261106' }, true)).toBe(true);
    expect(needsDecision({ analytics: true, ga4: false, decidedAt: '20261106' }, true)).toBe(false);
  });

  it('/r/ bağlantısından yönlendirme olayı', () => {
    const id = '01934f2a-7b3c-7d4e-8f50-123456789abc';
    expect(outboundFromHref(`/r/${id}?ch=3d`)).toEqual({ product_id: id, channel: '3d' });
    expect(outboundFromHref(`/r/${id}`)).toEqual({ product_id: id, channel: '2d' });
    expect(outboundFromHref('/urun/x')).toBeNull();
  });
});
