import { describe, expect, it } from 'vitest';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes.js';

describe('kurtarma kodları', () => {
  it('10 benzersiz kod üretir, biçim XXXX-XXXX-XX', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/);
  });

  it('küçük harf ve tiresiz yazımı normalleştirir, geçersizi reddeder', () => {
    const [code] = generateRecoveryCodes(1) as [string];
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ''))).toBe(code);
    expect(normalizeRecoveryCode('123456')).toBeNull();
    expect(normalizeRecoveryCode('OOOO-OOOO-OO')).toBeNull();
  });

  it('hash sabit ve koddan farklı', () => {
    expect(hashRecoveryCode('ABCD-EFGH-JK')).toBe(hashRecoveryCode('ABCD-EFGH-JK'));
    expect(hashRecoveryCode('ABCD-EFGH-JK')).not.toContain('ABCD');
  });
});
