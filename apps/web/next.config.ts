import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

/**
 * Halka açık web (K16, K49): SSR sayfalar, 2D katalog ve 3D istemci kabuğu.
 * /api istekleri üretimde nginx ile API'ye gider; geliştirmede buradan aktarılır.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3100';

const config: NextConfig = {
  transpilePackages: ['@dtd/contracts', '@dtd/scene-runtime', '@dtd/engine-three'],
  poweredByHeader: false,
  // Paylaşılan paketler NodeNext içe aktarımı kullanır ('./x.js' → x.ts); Turbopack bunu çözmediği için webpack
  webpack(cfg) {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return cfg;
  },
  // Güvenlik başlıkları her yanıtta (F6.1): CSP, HSTS, çerçeveleme yasağı, izin politikası
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV !== 'production') }];
  },
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }];
  },
};

export default config;
