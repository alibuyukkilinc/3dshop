import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '../../lib/api';

export const metadata: Metadata = {
  title: 'Türkiye haritası',
  description: 'Mağazaların gerçek şubeleri Türkiye haritasında; şubeden 3D şehirdeki vitrinine ya da mağaza sayfasına geçin.',
};
export const dynamic = 'force-dynamic';

interface Pin {
  id: string;
  store: { slug: string; name: string };
  lat: number;
  lng: number;
  precision: 'exact' | 'street' | 'district_center' | 'province_center';
  place: string;
}

/**
 * Türkiye sınırının sade çizimi (lng, lat), yaklaşık ve elle: pilotta harita verisi indirilmez. Doğru
 * sınır ve il/ilçe katmanı açık veriyle (lisans kaydı) sonra gelir.
 */
const OUTLINE: [number, number][] = [
  [26.0, 40.6], [26.3, 41.7], [27.4, 42.0], [28.0, 41.95], [29.1, 41.25], [30.4, 41.2], [31.4, 41.35], [32.4, 41.8], [33.3, 42.0], [34.5, 42.0], [35.1, 42.05],
  [36.0, 41.6], [36.4, 41.3], [37.2, 41.15], [38.0, 40.95], [39.6, 41.05], [40.6, 41.25], [41.5, 41.5], [42.4, 41.55], [42.8, 41.5], [43.5, 41.1],
  [43.7, 40.1], [44.6, 39.8], [44.8, 39.65], [44.4, 38.4], [44.3, 37.6], [44.2, 37.2], [43.0, 37.35], [42.4, 37.15], [41.2, 37.1], [40.2, 37.1],
  [39.2, 36.7], [38.2, 36.9], [37.0, 36.7], [36.6, 36.85], [36.1, 35.85], [35.8, 36.3], [36.2, 36.65], [35.5, 36.6], [34.6, 36.8], [33.6, 36.2],
  [32.5, 36.1], [31.6, 36.6], [31.0, 36.85], [30.4, 36.25], [29.4, 36.25], [28.2, 36.7], [27.4, 37.1], [27.2, 37.9], [26.4, 38.2], [26.8, 38.75],
  [26.3, 39.4], [26.6, 39.6], [26.2, 40.0], [26.0, 40.6],
];
const BOX = { minLng: 25.6, maxLng: 44.9, minLat: 35.7, maxLat: 42.2 };
const W = 960;
// Eşdikdörtgen izdüşüm, 39° enlemde yatay sıkıştırma (cos): şekil bozulmasın
const K = Math.cos((39 * Math.PI) / 180);
const H = Math.round(((BOX.maxLat - BOX.minLat) / ((BOX.maxLng - BOX.minLng) * K)) * W);
const px = (lng: number) => ((lng - BOX.minLng) / (BOX.maxLng - BOX.minLng)) * W;
const py = (lat: number) => ((BOX.maxLat - lat) / (BOX.maxLat - BOX.minLat)) * H;
const PRECISION = { exact: 'tam adres', street: 'sokak', district_center: 'ilçe merkezi', province_center: 'il merkezi' } as const;

/** Türkiye haritası (F4.3): şube pinleri → 3D vitrin ya da 2D mağaza. */
export default async function MapPage() {
  const { items } = await apiGet<{ items: Pin[] }>('/map/pins', 300);
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold">Türkiye haritası</h1>
      <p className="mt-2 max-w-2xl text-muted">Mağazaların gerçek şubeleri. Bir şubeden 3D şehirdeki vitrinine yürüyün ya da mağaza sayfasına geçin.</p>
      <figure className="mt-6 overflow-hidden rounded-xl border border-line bg-surface p-2">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Türkiye haritası üzerinde ${items.length} mağaza şubesi`} className="h-auto w-full">
          <polygon points={OUTLINE.map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join(' ')} className="fill-bg stroke-line" strokeWidth="2" />
          {items.map((p) => (
            <a key={p.id} href={`#sube-${p.id}`} aria-label={`${p.store.name}, ${p.place}`}>
              <circle cx={px(p.lng)} cy={py(p.lat)} r="9" className="fill-accent stroke-surface" strokeWidth="3" />
              <text x={px(p.lng) + 13} y={py(p.lat) + 5} className="fill-current text-[15px] font-medium">
                {p.store.name}
              </text>
            </a>
          ))}
        </svg>
        <figcaption className="px-2 pb-1 text-xs text-muted">Sade çizim; şube konumları pilotta ilçe merkezidir.</figcaption>
      </figure>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <li key={p.id} id={`sube-${p.id}`} className="rounded-lg border border-line bg-surface p-4">
            <p className="font-medium">{p.store.name}</p>
            <p className="text-sm text-muted">
              {p.place} · {PRECISION[p.precision]}
            </p>
            <div className="mt-3 flex gap-2 text-sm">
              <Link href={`/sehir?magaza=${p.store.slug}`} className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink">
                3D vitrine git
              </Link>
              <Link href={`/magaza/${p.store.slug}`} className="rounded-md border border-line px-3 py-1.5">
                Mağaza
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
