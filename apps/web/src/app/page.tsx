import Link from 'next/link';
import { type Store, apiGet } from '../lib/api';

// İstek anında üretilir: derleme sırasında API'ye bağlanmaz (deploy'da API henüz eski sürümde olabilir).
// Veri yine 60 sn önbellekte (apiGet revalidate).
export const dynamic = 'force-dynamic';

/** Ana sayfa: yayındaki mağazalar (2D vitrin, F2.3). 3D şehir kabuğu F4'te. */
export default async function HomePage() {
  const { items } = await apiGet<{ items: Store[] }>('/stores');
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold sm:text-4xl">Dijital Ticaret Dünyası</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Gerçek mağazaların ürünleri tek yerde. Fiyat ve stok mağazaların kendi sitesinden gelir; satın alma mağazanın sitesinde
        tamamlanır.
      </p>
      <h2 className="mt-10 text-xl font-semibold">Mağazalar</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-muted">Yakında: mağazalar yayına hazırlanıyor.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <li key={s.id}>
              <Link
                href={`/magaza/${s.slug}`}
                className="block h-full rounded-lg border border-line bg-surface p-4 hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {s.logo_url ? (
                  <span className="mb-3 flex h-14 items-center rounded-md bg-white px-3">
                    <img src={s.logo_url} alt="" className="max-h-11 max-w-full object-contain" loading="lazy" />
                  </span>
                ) : null}
                <p className="font-medium">{s.name}</p>
                <p className="mt-1 text-sm text-muted">{s.product_count} ürün</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
