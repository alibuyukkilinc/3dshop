import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductCard } from '../../components/product-card';
import { type ProductCard as Card, apiGet } from '../../lib/api';

export const metadata: Metadata = { title: 'Arama', robots: { index: false, follow: true } };

type Search = Promise<Record<string, string | string[] | undefined>>;
interface Result {
  q: string;
  total: number;
  page: number;
  page_size: number;
  items: (Card & { store: { slug: string; name: string } | null })[];
}

/** Ürün araması (search kanalı, K35). Sonuç sayfaları arama motorlarına kapalı (ince içerik). */
export default async function SearchPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(50, Number(sp.sayfa) || 1));
  const r = q ? await apiGet<Result>(`/search?q=${encodeURIComponent(q)}&page=${page}`) : null;
  const pages = r ? Math.max(1, Math.ceil(r.total / r.page_size)) : 1;
  const href = (p: number) => `/ara?q=${encodeURIComponent(q)}${p > 1 ? `&sayfa=${p}` : ''}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{q ? `“${q}” için sonuçlar` : 'Ürün ara'}</h1>
      {r && <p className="mt-1 text-sm text-muted">{r.total} ürün</p>}
      {r && r.items.length === 0 && <p className="mt-6 text-muted">Sonuç bulunamadı. Daha kısa ya da farklı bir kelime deneyin.</p>}
      {r && r.items.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {r.items.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} storeName={p.store?.name} />
          ))}
        </ul>
      )}
      {r && pages > 1 && (
        <nav aria-label="Sayfalar" className="mt-8 flex items-center justify-center gap-4 text-sm">
          {page > 1 ? (
            <Link rel="prev" href={href(page - 1)} className="hover:underline">
              ← Önceki
            </Link>
          ) : (
            <span className="text-muted">← Önceki</span>
          )}
          <span>
            Sayfa {page} / {pages}
          </span>
          {page < pages ? (
            <Link rel="next" href={href(page + 1)} className="hover:underline">
              Sonraki →
            </Link>
          ) : (
            <span className="text-muted">Sonraki →</span>
          )}
        </nav>
      )}
    </main>
  );
}
