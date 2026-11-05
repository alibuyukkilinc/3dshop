import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secrets.js';

const key = randomBytes(32).toString('base64');

describe('gizli değer şifreleme', () => {
  it('şifreler ve geri açar; her seferinde farklı çıktı', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('değiştirilmiş veriyi ve yanlış anahtarı reddeder', () => {
    const sealed = encryptSecret('gizli', key);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('baska').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(sealed, randomBytes(32).toString('base64'))).toThrow();
  });
});
