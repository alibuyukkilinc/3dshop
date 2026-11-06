import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Analytics } from '../components/analytics';
import { SiteFooter, SiteHeader } from '../components/site-header';
import { apiGet } from '../lib/api';
import { isIndexable, siteUrl } from '../lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: 'Dijital Ticaret Dünyası', template: '%s · Dijital Ticaret Dünyası' },
  description: 'Gerçek mağazaların gezilebilir 3D alışveriş şehri ve 2D kataloğu.',
  robots: isIndexable() ? { index: true, follow: true } : { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f17' },
  ],
};

/** GA4 kimliği yönetim panelinden (platform ayarı); API'ye ulaşılamazsa GA4 kapalı kalır. */
async function ga4Id(): Promise<string | null> {
  try {
    return (await apiGet<{ ga4_measurement_id: string | null }>('/site-config', 300)).ga4_measurement_id;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const ga4 = await ga4Id();
  return (
    <html lang="tr">
      <body>
        <a href="#icerik" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          İçeriğe geç
        </a>
        {/* Sayfalardan önce: sayfa bileşenlerinin olayları sağlayıcı kurulduktan sonra çalışır */}
        <Analytics ga4Id={ga4} />
        <SiteHeader />
        <div id="icerik">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
