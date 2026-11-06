import type { Metadata } from 'next';
import Link from 'next/link';
import { guideEnabled } from '../../lib/guide';
import { GuideClient } from './guide-client';

export const metadata: Metadata = {
  title: 'Alışveriş rehberi',
  description: 'Aradığınız ürünü ve mağazayı sorun; rehber yalnız sitedeki gerçek ürünlerden önerir.',
  robots: { index: false, follow: true },
};

/** AI rehber (F5.2, K52). Kapalıysa (anahtar yok) klasik aramaya yönlendirir. */
export default async function GuidePage() {
  const enabled = await guideEnabled();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Alışveriş rehberi</h1>
      {enabled ? (
        <>
          <p className="mt-1 text-sm text-muted">
            Ne aradığınızı yazın; rehber yalnız sitedeki mağazaların gerçek ürünlerinden önerir. Fiyat ve stok mağazanın
            sitesinden gelir. Kişisel bilgi yazmayın; sohbetler 30 gün saklanır.
          </p>
          <GuideClient />
        </>
      ) : (
        <p className="mt-4 text-muted">
          Rehber şu an kapalı.{' '}
          <Link href="/ara" className="text-accent underline">
            Ürün aramayı kullanın
          </Link>
          .
        </p>
      )}
    </main>
  );
}
