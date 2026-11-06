import type { Metadata } from 'next';
import { CityClient } from './city-client';

export const metadata: Metadata = {
  title: '3D şehir',
  description: 'Gerçek mağazaların 3D alışveriş şehri: yürüyerek ya da tramvayla gezin, vitrindeki ürünlere dokunun.',
};

type Search = Promise<Record<string, string | string[] | undefined>>;

/** 3D şehir (F4). Tamamen istemcide çizilir; WebGL yoksa 2D'ye düşer (K12). */
export default async function CityPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const store = typeof sp.magaza === 'string' && /^[a-z0-9-]{2,80}$/.test(sp.magaza) ? sp.magaza : undefined;
  return <CityClient worldSlug="merkez-sehir" startStore={store} />;
}
