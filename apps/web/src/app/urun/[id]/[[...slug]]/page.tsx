import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { PriceTag } from '../../../../components/price-tag';
import { NotFound, type Product, apiGet } from '../../../../lib/api';
import { formatMinor, minorToDecimal, productPath, slug as toSlug, timeAgo } from '../../../../lib/format';
import { siteUrl } from '../../../../lib/site';

export const revalidate = 60;

type Params = Promise<{ id: string; slug?: string[] }>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function load(id: string) {
  if (!UUID_RE.test(id)) notFound();
  try {
    return await apiGet<Product>(`/products/${id}`);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load((await params).id);
  const price = p.price ? ` — ${formatMinor(p.price.final_minor, p.price.currency)}` : '';
  return {
    title: `${p.name}${price}`,
    description: `${p.name}${price}. ${p.store.name} mağazasında. Satın alma mağazanın sitesinde.`,
    alternates: { canonical: productPath(p) },
    openGraph: { title: p.name, images: p.images.slice(0, 1) },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { id, slug } = await params;
  const p = await load(id);
  // Ad değişince eski adres yeni adrese kalıcı yönlenir (tek canonical, K9)
  if ((slug?.[0] ?? '') !== toSlug(p.name)) permanentRedirect(productPath(p));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: p.images.slice(0, 5),
    sku: p.sku ?? undefined,
    gtin13: p.barcode && /^\d{13}$/.test(p.barcode) ? p.barcode : undefined,
    mpn: p.mpn ?? undefined,
    brand: p.brand ? { '@type': 'Brand', name: p.brand.name } : undefined,
    offers: p.price
      ? {
          '@type': 'Offer',
          url: `${siteUrl()}${productPath(p)}`,
          price: minorToDecimal(p.price.final_minor),
          priceCurrency: p.price.currency,
          priceValidUntil: p.price.valid_until?.slice(0, 10),
          availability: p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          seller: { '@type': 'Organization', name: p.store.company.display_name },
        }
      : undefined,
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <nav aria-label="Konum" className="text-sm text-muted">
        <Link href="/" className="hover:underline">
          Mağazalar
        </Link>{' '}
        ›{' '}
        <Link href={`/magaza/${p.store.slug}`} className="hover:underline">
          {p.store.name}
        </Link>
        {p.primary_category && (
          <>
            {' '}
            ›{' '}
            <Link href={`/magaza/${p.store.slug}?kategori=${p.primary_category.slug}`} className="hover:underline">
              {p.primary_category.name}
            </Link>
          </>
        )}
      </nav>

      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <section aria-label="Görseller">
          <div className="aspect-square w-full overflow-hidden rounded-lg border border-line bg-white">
            {p.images[0] ? (
              <img
                src={p.images[0]}
                alt={p.name}
                width={800}
                height={800}
                fetchPriority="high"
                className="h-full w-full object-contain p-4"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">Görsel yok</div>
            )}
          </div>
          {p.images.length > 1 && (
            <ul className="mt-3 grid grid-cols-5 gap-2">
              {p.images.slice(1, 11).map((src, i) => (
                <li key={src} className="aspect-square overflow-hidden rounded border border-line bg-white">
                  <img src={src} alt={`${p.name} — görsel ${i + 2}`} width={160} height={160} loading="lazy" decoding="async" className="h-full w-full object-contain p-1" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="urun-adi">
          {p.brand && <p className="text-sm text-muted">{p.brand.name}</p>}
          <h1 id="urun-adi" className="mt-1 text-2xl font-semibold sm:text-3xl">
            {p.name}
          </h1>
          <div className="mt-4">
            <PriceTag price={p.price} />
            <p className={`mt-1 text-sm font-medium ${p.in_stock ? 'text-ok' : 'text-warn'}`}>{p.in_stock ? 'Stokta' : 'Stokta yok'}</p>
            <p className="mt-1 text-xs text-muted">
              Fiyat ve stok {p.store.name} sitesinden alındı · {timeAgo(p.synced_at)}
            </p>
          </div>

          {p.variants.length > 0 && (
            <table className="mt-6 w-full text-sm">
              <caption className="mb-2 text-left font-semibold">Seçenekler</caption>
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 font-medium">
                    Seçenek
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Fiyat
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Stok
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.variants.map((v) => (
                  <tr key={v.ref} className="border-t border-line">
                    <td className="py-2">{v.options.map((o) => `${o.group}: ${o.value}`).join(', ')}</td>
                    <td className="py-2 text-right tabular-nums">{v.price ? formatMinor(v.price.final_minor, v.price.currency) : '—'}</td>
                    <td className="py-2 text-right">{v.in_stock ? 'var' : 'yok'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {p.source_url && (
            <a
              href={p.source_url}
              rel="nofollow noopener"
              target="_blank"
              className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-md bg-accent px-6 font-medium text-accent-ink hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
            >
              {p.store.name} sitesinde satın al<span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          )}
          <p className="mt-2 text-xs text-muted">Ödeme ve teslimat {p.store.company.display_name} tarafından yapılır.</p>

          <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            {p.sku && (
              <>
                <dt className="text-muted">Stok kodu</dt>
                <dd>{p.sku}</dd>
              </>
            )}
            {p.barcode && (
              <>
                <dt className="text-muted">Barkod</dt>
                <dd>{p.barcode}</dd>
              </>
            )}
          </dl>
        </section>
      </div>

      {p.description_html && (
        <section aria-labelledby="aciklama" className="mt-10 max-w-3xl">
          <h2 id="aciklama" className="text-xl font-semibold">
            Ürün açıklaması
          </h2>
          {/* API'de izinli etiketlere indirgenmiş HTML (sanitize-html) */}
          <div className="prose-dtd mt-3" dangerouslySetInnerHTML={{ __html: p.description_html }} />
        </section>
      )}
    </main>
  );
}
