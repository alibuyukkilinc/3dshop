import { describe, expect, it } from 'vitest';
import { type ChainFields, GENESIS_HASH, canonicalJson, chainHash } from './chain.js';

const row: ChainFields = {
  id: '0193a000-0000-7000-8000-000000000001',
  at: '2026-11-05T19:00:00.000Z',
  seq: '1',
  actorType: 'admin',
  actorId: 'a1',
  action: 'identity.admin.login',
  entityType: 'admin_user',
  entityId: 'a1',
  changesetId: null,
  diff: { b: 2, a: 1 },
  reason: null,
  requestId: null,
  ipHash: null,
};

describe('denetim zinciri (K47)', () => {
  it('kanonik JSON anahtar sırasından bağımsızdır', () => {
    expect(canonicalJson({ b: 2, a: { d: 1, c: [3, 2] } })).toBe(canonicalJson({ a: { c: [3, 2], d: 1 }, b: 2 }));
  });

  it('aynı girdi aynı hash; alan ya da önceki hash değişince hash değişir', () => {
    const h = chainHash(GENESIS_HASH, row);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(chainHash(GENESIS_HASH, { ...row })).toBe(h);
    expect(chainHash(GENESIS_HASH, { ...row, action: 'identity.admin.logout' })).not.toBe(h);
    expect(chainHash(h, row)).not.toBe(h);
  });
});
