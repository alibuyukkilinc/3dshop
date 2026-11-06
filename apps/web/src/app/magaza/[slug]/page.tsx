import type { Metadata } from 'next';
import Link from 'next/link';
import { TrackOnMount } from '../../../components/analytics';
import { notFound } from 'next/navigation';
import { ProductCard } from '../../../components/product-card';
import { NotFound, type ProductPage, type StoreDetail, apiGet } from '../../../lib/api';

export const revalidate = 60;

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const SORTS = [
  ['relevance', 'Önerilen'],
  ['price_asc', 'Fiyat (artan)'],
  ['price_desc', 'Fiyat (azalan)'],
  ['newest', 'En yeni'],
  ['name', 'Ada göre'],
] as const;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function loadStore(slug: string) {
  if (!SLUG_RE.test(slug)) notFound();
  try {
    return await apiGet<StoreDetail>(`/stores/${slug}`);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const store = await loadStore((await params).slug);
  return {
    title: store.name,
    description: `${store.name}: ${store.product_count} ürün. Fiyat ve stok mağazanın sitesinden; satın alma mağazanın sitesinde.`,
    alternates: { canonical: `/magaza/${store.slug}` },
  };
}

export default async function StorePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const category = one('kategori');
  const brand = one('marka');
  const sort = SORTS.some(([s]) => s === one('sirala')) ? one('sirala')! : 'relevance';
  const page = Math.max(1, Math.min(500, Number(one('sayfa')) || 1));
  const inStock = one('stokta') === '1';

  const store = await loadStore(slug);
  const qs = new URLSearchParams({
    sort,
    page: String(page),
    ...(category && SLUG_RE.test(category) && { category }),
    ...(brand && SLUG_RE.test(brand) && { brand }),
    ...(inStock && { in_stock: '1' }),
  });
  const products = await apiGet<ProductPage>(`/stores/${slug}/products?${qs}`);
  const pages = Math.max(1, Math.ceil(products.total / products.page_size));

  /** Mevcut filtreleri koruyarak bağlantı kurar (sayfa sıfırlanır). */
  const href = (change: Record<string, string | undefined>) => {
    const next = { kategori: category, marka: brand, sirala: sort === 'relevance' ? undefined : sort, stokta: inStock ? '1' : undefined, ...change };
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    return `/magaza/${slug}${q.size ? `?${q}` : ''}`;
  };

  const roots = store.facets.categories.filter((c) => !c.parent_id || !store.facets.categories.some((p) => p.id === c.parent_id));
  const childrenOf = (id: string) => store.facets.categories.filter((c) => c.parent_id === id).sort((a, b) => a.sort - b.sort);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <TrackOnMount name="store_enter" props={{ store_id: store.id, surface: '2d' }} />
      <nav aria-label="Konum" className="text-sm text-muted">
        <Link href="/" className="hover:underline">
          Mağazalar
        </Link>{' '}
        › <span aria-current="page">{store.name}</span>
      </nav>
      <h1 className="mt-2 text-3xl font-semibold">{store.name}</h1>
      <p className="mt-1 text-sm text-muted">{store.product_count} ürün</p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[14rem_1fr]">
        <aside aria-label="Filtreler" className="space-y-6 text-sm">
          {store.facets.categories.length > 0 && (
            <section>
              <h2 className="font-semibold">Kategori</h2>
              <ul className="mt-2 space-y-1">
                <li>
                  <Link href={href({ kategori: undefined, sayfa: undefined })} aria-current={!category ? 'true' : undefined} className={!category ? 'font-semibold' : 'hover:underline'}>
                    Tümü
                  </Link>
                </li>
                {roots.map((c) => (
                  <li key={c.id}>
                    <Link href={href({ kategori: c.slug, sayfa: undefined })} aria-current={category === c.slug ? 'true' : undefined} className={category === c.slug ? 'font-semibold' : 'hover:underline'}>
                      {c.name} <span className="text-muted">({c.count})</span>
                    </Link>
                    {childrenOf(c.id).length > 0 && (
                      <ul className="mt-1 ml-3 space-y-1">
                        {childrenOf(c.id).map((k) => (
                          <li key={k.id}>
                            <Link href={href({ kategori: k.slug, sayfa: undefined })} aria-current={category === k.slug ? 'true' : undefined} className={category === k.slug ? 'font-semibold' : 'hover:underline'}>
                              {k.name} <span className="text-muted">({k.count})</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {store.facets.brands.length > 0 && (
            <section>
              <h2 className="font-semibold">Marka</h2>
              <ul className="mt-2 space-y-1">
                <li>
                  <Link href={href({ marka: undefined, sayfa: undefined })} className={!brand ? 'font-semibold' : 'hover:underline'}>
                    Tümü
                  </Link>
                </li>
                {store.facets.brands.map((b) => (
                  <li key={b.id}>
                    <Link href={href({ marka: b.slug, sayfa: undefined })} aria-current={brand === b.slug ? 'true' : undefined} className={brand === b.slug ? 'font-semibold' : 'hover:underline'}>
                      {b.name} <span className="text-muted">({b.count})</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2 className="font-semibold">Stok</h2>
            <Link href={href({ stokta: inStock ? undefined : '1', sayfa: undefined })} className="mt-2 inline-block hover:underline" aria-pressed={inStock}>
              {inStock ? '✓ Yalnız stokta olanlar' : 'Yalnız stokta olanlar'}
            </Link>
          </section>
        </aside>

        <section aria-labelledby="urunler">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="urunler" className="text-sm text-muted">
              {products.total} ürün
            </h2>
            <nav aria-label="Sıralama">
              <ul className="flex flex-wrap gap-2 text-sm">
                {SORTS.map(([value, label]) => (
                  <li key={value}>
                    <Link
                      href={href({ sirala: value === 'relevance' ? undefined : value, sayfa: undefined })}
                      aria-current={sort === value ? 'true' : undefined}
                      className={sort === value ? 'rounded-full bg-ink px-3 py-1 text-bg' : 'rounded-full border border-line px-3 py-1 hover:border-accent'}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          {products.items.length === 0 ? (
            <p className="mt-8 text-muted">Bu filtrelerle ürün yok.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.items.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 4} />
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label="Sayfalar" className="mt-8 flex items-center justify-center gap-4 text-sm">
              {page > 1 ? (
                <Link rel="prev" href={href({ sayfa: page > 2 ? String(page - 1) : undefined })} className="hover:underline">
                  ← Önceki
                </Link>
              ) : (
                <span className="text-muted">← Önceki</span>
              )}
              <span>
                Sayfa {page} / {pages}
              </span>
              {page < pages ? (
                <Link rel="next" href={href({ sayfa: String(page + 1) })} className="hover:underline">
                  Sonraki →
                </Link>
              ) : (
                <span className="text-muted">Sonraki →</span>
              )}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
