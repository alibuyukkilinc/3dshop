import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from './webhook-signature.js';

describe('webhook imzası (B2)', () => {
  const secret = 'sir-0123456789';
  const body = Buffer.from('{"event":"price.changed","site":"x","product_ids":[1]}');
  const now = 1_793_900_000_000;
  const ts = String(now / 1000);

  it('doğru imzayı kabul eder; "sha256=" önekine izin verir', () => {
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhook(secret, { timestamp: ts, signature: sig }, body, now)).toEqual({ ok: true });
    expect(verifyWebhook(secret, { timestamp: ts, signature: `sha256=${sig.toUpperCase()}` }, body, now)).toEqual({ ok: true });
  });

  it('gövde, sır ya da zaman değişirse reddeder', () => {
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhook(secret, { timestamp: ts, signature: sig }, Buffer.from(`${body} `), now)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyWebhook('baska-sir', { timestamp: ts, signature: sig }, body, now)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyWebhook(secret, { timestamp: ts, signature: sig }, body, now + 301_000)).toEqual({ ok: false, reason: 'stale' });
    expect(verifyWebhook(secret, { timestamp: ts }, body, now)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyWebhook(secret, { timestamp: ts, signature: 'abc' }, body, now)).toEqual({ ok: false, reason: 'mismatch' });
  });
});
