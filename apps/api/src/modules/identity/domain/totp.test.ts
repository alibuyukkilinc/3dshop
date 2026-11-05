import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUrl, totpStep, verifyTotp } from './totp.js';

// RFC 6238 Ek B, SHA1 sırrı: ASCII "12345678901234567890"
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP (RFC 6238)', () => {
  it('base32 gidiş-dönüş ve RFC sırrı', () => {
    expect(base32Encode(RFC_SECRET)).toBe(RFC_B32);
    expect(base32Decode(RFC_B32).equals(RFC_SECRET)).toBe(true);
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i -> %s (8 hane)', (t, code) => {
    expect(hotp(RFC_SECRET, totpStep(t * 1000), 8)).toBe(code);
  });

  it('6 haneli kod ±1 adımda kabul edilir, daha uzakta reddedilir', () => {
    const t = 1234567890 * 1000;
    const code = hotp(RFC_SECRET, totpStep(t));
    expect(verifyTotp(RFC_B32, code, t, null)).toBe(totpStep(t));
    expect(verifyTotp(RFC_B32, code, t + 30_000, null)).toBe(totpStep(t));
    expect(verifyTotp(RFC_B32, code, t + 90_000, null)).toBeNull();
  });

  it('aynı adımın kodu ikinci kez kullanılamaz', () => {
    const t = 1234567890 * 1000;
    const code = hotp(RFC_SECRET, totpStep(t));
    const step = verifyTotp(RFC_B32, code, t, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(RFC_B32, code, t, step)).toBeNull();
  });

  it('biçimsiz kodu reddeder', () => {
    expect(verifyTotp(RFC_B32, '12a456', Date.now(), null)).toBeNull();
    expect(verifyTotp(RFC_B32, '1234567', Date.now(), null)).toBeNull();
  });

  it('otpauth adresi', () => {
    const url = otpauthUrl('firmaxi', 'ali@example.com', RFC_B32);
    expect(url.startsWith('otpauth://totp/firmaxi%3Aali%40example.com?')).toBe(true);
    expect(url).toContain(`secret=${RFC_B32}`);
  });
});
