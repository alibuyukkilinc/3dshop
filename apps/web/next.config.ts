import type { NextConfig } from 'next';

/**
 * Halka açık web (K16, K49): SSR sayfalar, 2D katalog ve 3D istemci kabuğu.
 * /api istekleri üretimde nginx ile API'ye gider; geliştirmede buradan aktarılır.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3100';

const config: NextConfig = {
  transpilePackages: ['@dtd/contracts'],
  poweredByHeader: false,
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }];
  },
};

export default config;
