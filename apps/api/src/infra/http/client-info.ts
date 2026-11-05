import type { Request } from 'express';
import { sha256Hex } from '../crypto/secrets.js';

/** Denetim ve oturum için istemci bilgisi. IP açık saklanmaz, yalnız özeti (KVKK). */
export interface ClientInfo {
  ipHash: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function clientInfo(req: Request): ClientInfo {
  const ip = req.ip ?? null;
  return {
    ipHash: ip ? sha256Hex(`ip:${ip}`).slice(0, 32) : null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    requestId: req.get('x-request-id')?.slice(0, 100) ?? null,
  };
}
