import { describe, expect, it } from 'vitest';
import { firstAppFrame, fingerprint, normalizeMessage } from './fingerprint.js';

const stack = (line: string) =>
  `Error: x\n    at Object.f (C:\\proj\\node_modules\\lib\\index.js:1:1)\n    at Svc.run (C:\\proj\\apps\\api\\src\\modules\\x\\svc.ts:${line})\n    at node:internal/x:1:1`;

describe('hata parmak izi', () => {
  it('değişken değerleri atar', () => {
    expect(normalizeMessage('Ürün 0193a000-0000-7000-8000-000000000001 bulunamadı (42 deneme) "abc"')).toBe(
      'Ürün <id> bulunamadı (<n> deneme) <str>',
    );
  });

  it('ilk proje çerçevesini satır numarasız alır', () => {
    expect(firstAppFrame(stack('10:5'))).toBe('Svc.run (apps/api/src/modules/x/svc.ts');
  });

  it('aynı tür hata aynı iz, satır kayması izi değiştirmez; farklı tür farklı iz', () => {
    const a = fingerprint('api', 'TypeError', 'Cannot read 1', stack('10:5'));
    const b = fingerprint('api', 'TypeError', 'Cannot read 2', stack('12:9'));
    const c = fingerprint('worker', 'TypeError', 'Cannot read 1', stack('10:5'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
