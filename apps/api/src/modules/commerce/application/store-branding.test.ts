import { describe, expect, it } from 'vitest';
import { extractBranding } from './store-branding.js';

const SITE = 'https://esensolarmarket.com';

describe('mağaza logosu ve ikonu (kaynak siteden)', () => {
  it('tema logosu (lazy data-src) ve PNG ikon; favicon.ico ikinci planda', () => {
    const html = `<head>
      <meta property="og:image" content="https://cdn.example.com/card.jpg"/>
      <link rel="icon" href="https://esensolarmarket.com/favicon.ico">
      <link rel="icon" href="https://cdn.shopyplus.com/esensolarmarket.com/2026-02/esen-fav.png">
    </head><body>
      <img src="view/images/load.gif" width="199" data-src="https://cdn.shopyplus.com/esensolarmarket.com/2026-02/logo-esen-yeni.png" alt="Esen Solar Market" class="logo lazyload">
    </body>`;
    expect(extractBranding(html, SITE)).toEqual({
      logo: 'https://cdn.shopyplus.com/esensolarmarket.com/2026-02/logo-esen-yeni.png',
      icon: 'https://cdn.shopyplus.com/esensolarmarket.com/2026-02/esen-fav.png',
    });
  });

  it('logo yoksa og:image; göreli adres siteye göre tamamlanır; http reddedilir', () => {
    const html = `<meta property="og:image" content="/img/share.png"><link rel="shortcut icon" href="http://x.com/f.ico">`;
    expect(extractBranding(html, SITE)).toEqual({ logo: 'https://esensolarmarket.com/img/share.png', icon: null });
  });

  it('hiçbiri yoksa boş', () => {
    expect(extractBranding('<html><body>Merhaba</body></html>', SITE)).toEqual({ logo: null, icon: null });
  });
});
