import { useSyncExternalStore } from 'react';

/**
 * Platform sepeti (K14 pilot): tarayıcıda tutulur, sunucuya yazılmaz, kişisel veri yok. Ödeme kaynak sitede:
 * "Siparişi tamamla" ürünleri /r/{ürün} üzerinden mağazanın sitesine yönlendirir (K53). Fiyat kaynağın son
 * fiyatıdır (K41); sepet açılınca canlı fiyatla yenilenir. Ara toplam yalnız gösterilen fiyatların toplamıdır
 * ("tahmini"): kargo, indirim ve kesin tutar mağazanın sitesinde.
 */

export interface CartPrice {
  final_minor: number;
  list_minor: number;
  currency: string;
}

export interface CartItem {
  product_id: string;
  store_slug: string;
  store_name: string;
  name: string;
  image: string | null;
  price: CartPrice | null;
  in_stock: boolean;
  qty: number;
  added_at: number;
}

export const CART_KEY = 'dtd.cart.v1';
export const MAX_QTY = 20;
export const MAX_ITEMS = 60;

// ------------------------------------------------------------------ saf hesaplar (test edilir)

/** Ürünü ekler ya da adedini artırır (en çok MAX_QTY); yeni ürün en üste. Sepet doluysa değişmez. */
export function addItem(items: CartItem[], item: Omit<CartItem, 'qty' | 'added_at'>, qty: number, now: number): CartItem[] {
  const n = Math.max(1, Math.floor(qty));
  const found = items.find((i) => i.product_id === item.product_id);
  if (found) return items.map((i) => (i === found ? { ...i, ...item, qty: Math.min(MAX_QTY, i.qty + n) } : i));
  if (items.length >= MAX_ITEMS) return items;
  return [{ ...item, qty: Math.min(MAX_QTY, n), added_at: now }, ...items];
}

/** Adet değişimi; 0 ya da altı ürünü çıkarır */
export function setItemQty(items: CartItem[], productId: string, qty: number): CartItem[] {
  const n = Math.floor(qty);
  if (n <= 0) return items.filter((i) => i.product_id !== productId);
  return items.map((i) => (i.product_id === productId ? { ...i, qty: Math.min(MAX_QTY, n) } : i));
}

/** Canlı fiyat/stok yenilemesi */
export function applyLive(items: CartItem[], live: Map<string, { price: CartPrice | null; in_stock: boolean }>): CartItem[] {
  let changed = false;
  const out = items.map((i) => {
    const l = live.get(i.product_id);
    if (!l) return i;
    if (l.in_stock === i.in_stock && l.price?.final_minor === i.price?.final_minor && l.price?.list_minor === i.price?.list_minor) return i;
    changed = true;
    return { ...i, price: l.price, in_stock: l.in_stock };
  });
  return changed ? out : items;
}

/** Mağazaya göre gruplar (her mağazanın ödemesi kendi sitesinde); ilk eklenen mağaza önce değil, son eklenen önce */
export function groupByStore(items: CartItem[]): { store_slug: string; store_name: string; items: CartItem[] }[] {
  const groups = new Map<string, { store_slug: string; store_name: string; items: CartItem[] }>();
  for (const i of items) {
    const g = groups.get(i.store_slug) ?? { store_slug: i.store_slug, store_name: i.store_name, items: [] };
    g.items.push(i);
    groups.set(i.store_slug, g);
  }
  return [...groups.values()];
}

/**
 * Tahmini ara toplam (kuruş, tam sayı; K33): fiyatı olan ürünlerin fiyat × adet toplamı. Para birimi tekse
 * döner; fiyatsız ürün varsa `partial` (toplam eksik). Kargo/indirim dahil değildir.
 */
export function subtotal(items: CartItem[]): { minor: number; currency: string; partial: boolean } | null {
  const priced = items.filter((i) => i.price);
  if (!priced.length) return null;
  const currency = priced[0]!.price!.currency;
  if (priced.some((i) => i.price!.currency !== currency)) return null;
  const minor = priced.reduce((a, i) => a + i.price!.final_minor * i.qty, 0);
  return { minor, currency, partial: priced.length < items.length };
}

export function countOf(items: CartItem[]): number {
  return items.reduce((a, i) => a + i.qty, 0);
}

/** Bozuk ya da eski biçimli kaydı ayıklar */
export function parseCart(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (i): i is CartItem =>
          !!i &&
          typeof i === 'object' &&
          typeof (i as CartItem).product_id === 'string' &&
          /^[0-9a-f-]{36}$/.test((i as CartItem).product_id) &&
          typeof (i as CartItem).name === 'string' &&
          typeof (i as CartItem).store_slug === 'string' &&
          Number.isInteger((i as CartItem).qty) &&
          (i as CartItem).qty > 0,
      )
      .slice(0, MAX_ITEMS)
      .map((i) => ({ ...i, qty: Math.min(MAX_QTY, i.qty) }));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ depo (localStorage + sekmeler arası)

const EMPTY: CartItem[] = [];
let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function load(): CartItem[] {
  if (cache) return cache;
  try {
    cache = parseCart(window.localStorage.getItem(CART_KEY));
  } catch {
    cache = [];
  }
  return cache;
}

function save(next: CartItem[]) {
  if (next === cache) return;
  cache = next;
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(next));
  } catch {
    /* gizli sekme / kota: sepet bu sayfada yaşar */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CART_KEY) return;
    cache = null;
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export const cart = {
  items: () => load(),
  add: (item: Omit<CartItem, 'qty' | 'added_at'>, qty = 1) => save(addItem(load(), item, qty, Date.now())),
  setQty: (productId: string, qty: number) => save(setItemQty(load(), productId, qty)),
  remove: (productId: string) => save(setItemQty(load(), productId, 0)),
  clearStore: (storeSlug: string) => save(load().filter((i) => i.store_slug !== storeSlug)),
  applyLive: (live: Map<string, { price: CartPrice | null; in_stock: boolean }>) => save(applyLive(load(), live)),
};

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}
