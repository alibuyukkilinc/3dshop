/**
 * Sunucu tarafı API istemcisi (SSR). Tarayıcı API'ye doğrudan gitmez; sayfa sunucuda kurulur (K9, K16).
 * Yanıtlar 60 sn önbellekte tutulur: fiyat/stok zaten kaynaktan dakikalar içinde gelir (K5).
 */
const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3100';

export class NotFound extends Error {}

export async function apiGet<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, { next: { revalidate }, headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new NotFound(path);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}

export interface Price {
  final_minor: number;
  list_minor: number;
  currency: string;
  valid_until: string | null;
}
export interface Store {
  id: string;
  slug: string;
  name: string;
  /** Kaynak sitenin logosu ve ikonu (https, kaynak CDN) */
  logo_url?: string | null;
  icon_url?: string | null;
  company: { display_name: string; website: string | null };
  product_count: number;
}
export interface StoreDetail extends Store {
  facets: {
    categories: { id: string; parent_id: string | null; slug: string; name: string; sort: number; count: number }[];
    brands: { id: string; slug: string; name: string; count: number }[];
  };
}
export interface ProductCard {
  id: string;
  name: string;
  price: Price | null;
  in_stock: boolean;
  image: string | null;
  synced_at: string;
}
export interface ProductPage {
  total: number;
  page: number;
  page_size: number;
  items: ProductCard[];
}
export interface Product {
  id: string;
  name: string;
  description_html: string;
  sku: string | null;
  barcode: string | null;
  mpn: string | null;
  price: Price | null;
  in_stock: boolean;
  images: string[];
  variants: { ref: string; options: { group: string; value: string }[]; price: Price | null; in_stock: boolean }[];
  primary_category: { id: string; slug: string; name: string } | null;
  source_url: string | null;
  synced_at: string;
  store: { id: string; slug: string; name: string; company: { display_name: string } };
  brand: { id: string; slug: string; name: string } | null;
}
