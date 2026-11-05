import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Gelen webhook imzası (B2): X-DTD-Signature = hex(HMAC-SHA256(secret, timestamp + "." + ham gövde)).
 * X-DTD-Timestamp Unix saniyesidir; 5 dakikadan eski ya da ileri tarihli istek reddedilir (tekrar saldırısı).
 */
export const SIGNATURE_WINDOW_SECONDS = 300;

export function signWebhook(secret: string, timestamp: string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export type SignatureCheck = { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'mismatch' };

export function verifyWebhook(
  secret: string,
  headers: { timestamp?: string; signature?: string },
  rawBody: Buffer,
  nowMs = Date.now(),
): SignatureCheck {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature) return { ok: false, reason: 'missing' };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: 'stale' };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: 'stale' };
  const given = signature.trim().toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(given)) return { ok: false, reason: 'mismatch' };
  const expected = signWebhook(secret, timestamp, rawBody);
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex')) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
