import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
