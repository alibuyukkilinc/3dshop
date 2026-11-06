import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

describe('güvenlik başlıkları (F6.1)', () => {
  it('üretim CSP: çerçeveleme ve nesne kapalı, eval yok, GA4 izinli, HTTPS yükseltme', () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain('https://www.googletagmanager.com');
    expect(csp).toContain('upgrade-insecure-requests');
    // GLTFLoader GLB içi dokuları blob: adresinden fetch eder; engellenirse binalar dokusuz (gri) kalır
    expect(csp).toMatch(/connect-src [^;]*blob:/);
  });

  it('geliştirmede HMR için eval ve ws; HSTS yok', () => {
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
    expect(securityHeaders(true).some((h) => h.key === 'Strict-Transport-Security')).toBe(false);
    expect(securityHeaders(false).find((h) => h.key === 'Strict-Transport-Security')?.value).toMatch(/max-age=31536000/);
  });
});
