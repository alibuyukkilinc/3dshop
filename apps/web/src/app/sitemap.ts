import type { MetadataRoute } from 'next';
import { apiGet } from '../lib/api';
import { productPath } from '../lib/format';
import { isIndexable, siteUrl } from '../lib/site';

// Derleme sırasında değil, istek anında (deploy'da API henüz yeni sürümde olmayabilir)
export const dynamic = 'force-dynamic';

interface SitemapData {
  stores: { slug: string }[];
  products: { id: string; name: string; updated_at: string }[];
}

/** Site haritası (K9): seo kanalında görünen mağaza ve ürünler. Arama motoruna kapalı ortamda boş. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isIndexable()) return [];
  const base = siteUrl();
  const data = await apiGet<SitemapData>('/sitemap', 300);
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    ...data.stores.map((s) => ({ url: `${base}/magaza/${s.slug}`, changeFrequency: 'daily' as const, priority: 0.8 })),
    ...data.products.map((p) => ({
      url: `${base}${productPath(p)}`,
      lastModified: p.updated_at,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
  ];
}
