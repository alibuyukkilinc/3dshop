import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainFields {
  id: string;
  at: string;
  seq: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changesetId: string | null;
  diff: unknown;
  reason: string | null;
  requestId: string | null;
  ipHash: string | null;
}

/** JSON'u anahtarları sıralı biçimde yazar: aynı veri her zaman aynı hash'i verir. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** hash = SHA-256(prev_hash + "\n" + kanonik satır). Zincirdeki her satır öncekine bağlıdır (K47). */
export function chainHash(prevHash: string, fields: ChainFields): string {
  return createHash('sha256').update(`${prevHash}\n${canonicalJson(fields)}`, 'utf8').digest('hex');
}
