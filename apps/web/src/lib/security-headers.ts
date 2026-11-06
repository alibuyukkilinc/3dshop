/**
 * Halka açık web'in güvenlik başlıkları (F6.1, C3 güvenlik listesi). next.config headers() ile her yanıta eklenir.
 *
 * CSP notları:
 * - script-src 'unsafe-inline': Next.js App Router RSC verisini satır içi betikle gönderir. Nonce her sayfayı
 *   dinamik yapar ve ISR önbelleğini (revalidate 60) bozar; bilinçli ödünleşim. Dış betik yalnız GA4 (rızayla).
 * - 'wasm-unsafe-eval': 3D modellerdeki Meshopt sıkıştırmasını çözen WebAssembly (F3.2).
 * - img-src https: — ürün görselleri kaynak sitelerin CDN'lerinden gelir (K41); blob: GLB içi dokular.
 * - connect-src: API, bölge paketleri ve varlıklar aynı kaynaktan; blob:/data: GLB içi dokular (GLTFLoader fetch); GA4.
 */
const GA = ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'];

export function contentSecurityPolicy(dev = false): string {
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://www.googletagmanager.com', ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    // blob:/data: GLTFLoader model içi dokuları fetch ile okur (connect-src'e tabi)
    'connect-src': ["'self'", 'blob:', 'data:', ...GA, ...(dev ? ['ws:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'manifest-src': ["'self'"],
  };
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function securityHeaders(dev = false): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(dev) },
    // HSTS yalnız HTTPS'te anlamlı; tarayıcı HTTP yanıtındakini yok sayar. Önyükleme listesi canlıya geçişte ayrıca.
    ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Kamera/mikrofon/konum kullanılmaz; 3D için tam ekran ve jiroskop serbest
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}
