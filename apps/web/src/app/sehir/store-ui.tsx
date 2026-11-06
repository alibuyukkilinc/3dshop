'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../lib/analytics/client';
import { type CartItem, MAX_QTY, cart, countOf, groupByStore, subtotal, useCart } from '../../lib/cart';
import type { InteriorData, InteriorProduct } from '../../lib/city/interior';
import { formatMinor } from '../../lib/format';

/**
 * 3D mağaza deneyimi (HTML katmanı): mağaza içinde web sitesi gibi gezinme — arama, koridor kısayolları,
 * dönen vitrinli ürün kartı, adet ve sepete ekleme (uçuş efekti), alt sepet çubuğu ve sepet. Ödeme kaynak
 * sitede (K14 pilot, K53 /r/ yönlendirmesi). Fiyat kaynağın son fiyatıdır (K41). Mobil öncelikli.
 */

export interface ProductInfo {
  id: string;
  name: string;
  price: { final_minor: number; list_minor: number; currency: string } | null;
  in_stock: boolean;
  store: { id?: string; slug: string; name: string };
  images: string[];
  description_html?: string;
  brand?: { name: string } | null;
  primary_category?: { name: string } | null;
}

const CART_TARGET = 'dtd-cart-target';
const price = (p: { final_minor: number; currency: string } | null) => (p ? formatMinor(p.final_minor, p.currency) : 'Fiyat sitede');

// ------------------------------------------------------------------ mağaza üst çubuğu

export function StoreHud({
  data,
  accent,
  onSection,
  onPick,
  onExit,
}: {
  data: InteriorData;
  accent: string;
  onSection: (index: number) => void;
  onPick: (productId: string) => void;
  onExit: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: (InteriorProduct & { key: string })[] = [];
    for (const s of data.sections)
      for (const p of s.products)
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push({ ...p, key: p.name.toLocaleLowerCase('tr') });
        }
    return out;
  }, [data]);
  const term = q.trim().toLocaleLowerCase('tr');
  const results = term.length >= 2 ? all.filter((p) => term.split(/\s+/).every((w) => p.key.includes(w))).slice(0, 8) : [];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl bg-white/95 py-1.5 pr-3 pl-1.5 text-black shadow-lg backdrop-blur">
          {data.store.icon_url ? (
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-gray-200" aria-hidden>
              <img src={data.store.icon_url} alt="" className="size-7 object-contain" />
            </span>
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl text-base font-bold text-white" style={{ background: accent }} aria-hidden>
              {data.store.name.slice(0, 1).toLocaleUpperCase('tr')}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm leading-tight font-semibold">{data.store.name}</span>
            <span className="block truncate text-[11px] leading-tight text-gray-600">
              {data.total} ürün · {data.sections.length} koridor
            </span>
          </span>
        </div>
        <div className={`pointer-events-auto relative min-w-0 flex-1 ${searchOpen ? '' : 'max-sm:flex-none'}`}>
          <label className="sr-only" htmlFor="dtd-store-search">
            Mağazada ara
          </label>
          <div className="flex items-center rounded-2xl bg-white/95 text-black shadow-lg backdrop-blur">
            <button type="button" className="grid size-11 shrink-0 place-items-center text-gray-600" onClick={() => setSearchOpen(true)} aria-label="Mağazada ara">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
            </button>
            <input
              id="dtd-store-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="Bu mağazada ara…"
              className={`h-11 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none ${searchOpen ? '' : 'max-sm:hidden'}`}
              autoComplete="off"
              enterKeyHint="search"
            />
            {searchOpen && (
              <button type="button" className="px-3 text-gray-500 sm:hidden" onClick={() => (setSearchOpen(false), setQ(''))} aria-label="Aramayı kapat">
                ✕
              </button>
            )}
          </div>
          {results.length > 0 && (
            <ul className="absolute inset-x-0 top-full mt-2 max-h-[55vh] overflow-y-auto rounded-2xl bg-white p-1.5 text-black shadow-2xl">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-gray-100"
                    onClick={() => {
                      onPick(p.id);
                      setQ('');
                      setSearchOpen(false);
                    }}
                  >
                    {p.thumb ? <img src={p.thumb} alt="" className="size-11 shrink-0 rounded-lg object-contain" /> : <span className="size-11 shrink-0 rounded-lg bg-gray-100" />}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm">{p.name}</span>
                      <span className="text-xs font-semibold" style={{ color: accent }}>
                        {p.in_stock ? price(p.price) : 'Stokta yok'}
                      </span>
                    </span>
                    <span className="text-xs text-gray-500">Rafa git →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {term.length >= 2 && results.length === 0 && <p className="absolute inset-x-0 top-full mt-2 rounded-2xl bg-white p-3 text-sm text-gray-600 shadow-2xl">Bu mağazada bulunamadı.</p>}
        </div>
        <button type="button" onClick={onExit} className="pointer-events-auto h-11 shrink-0 rounded-2xl bg-white/95 px-3 text-sm font-semibold text-black shadow-lg backdrop-blur">
          Çıkış
        </button>
      </div>
      <nav aria-label="Koridorlar" className="dtd-scroll-x pointer-events-auto -mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
        {data.sections.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => (setActive(i), onSection(i))}
            className="shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold whitespace-nowrap shadow-md backdrop-blur transition"
            style={active === i ? { background: accent, color: '#fff' } : { background: 'rgba(255,255,255,0.92)', color: '#111' }}
          >
            {s.label} <span className="opacity-60">{s.products.length}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ hoş geldiniz

export function WelcomeToast({ data, accent }: { data: InteriorData; accent: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShown(false), 4200);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-32 z-10 flex justify-center px-4" role="status">
      <div className="dtd-toast max-w-sm rounded-2xl bg-white/95 px-5 py-3 text-center text-black shadow-2xl backdrop-blur">
        <p className="text-xs font-semibold tracking-wide uppercase" style={{ color: accent }}>
          Hoş geldiniz
        </p>
        <p className="text-base font-bold">{data.store.name}</p>
        <p className="text-xs text-gray-600">Ürüne dokunun: inceleyin, sepete ekleyin. Koridor düğmeleri sizi rafa götürür.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dönen vitrin

/** Ürün görseli çift yüzlü kartta yavaşça döner; sürükleyerek çevrilir (atalet), görseller arasında geçilir */
function ShowcaseSpin({ images, accent, name }: { images: string[]; accent: string; name: string }) {
  const [idx, setIdx] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const state = useRef({ a: -18, v: 0, drag: null as null | { x: number; t: number }, last: 0 });
  const src = images[idx] ?? images[0];

  useEffect(() => setIdx(0), [images]);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const s = state.current;
    s.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      if (!s.drag) {
        // Atalet söner, sonra kendiliğinden dönüş (saniyede 28°)
        s.v *= Math.exp(-dt * 2.5);
        s.a += s.v * dt + (reduce ? 0 : 28 * dt * (1 - Math.min(1, Math.abs(s.v) / 200)));
      }
      if (card.current) card.current.style.transform = `rotateY(${s.a}deg) rotateX(4deg)`;
      if (shadow.current) shadow.current.style.transform = `scaleX(${0.55 + 0.45 * Math.abs(Math.cos((s.a * Math.PI) / 180))})`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    state.current.drag = { x: e.clientX, t: performance.now() };
    state.current.v = 0;
  };
  const move = (e: React.PointerEvent) => {
    const s = state.current;
    if (!s.drag) return;
    const now = performance.now();
    const dx = e.clientX - s.drag.x;
    s.a += dx * 0.6;
    s.v = (dx * 0.6) / Math.max(0.008, (now - s.drag.t) / 1000);
    s.drag = { x: e.clientX, t: now };
  };
  const up = () => {
    state.current.drag = null;
    state.current.v = Math.max(-900, Math.min(900, state.current.v));
  };

  const face = (back: boolean) => (
    <div
      className="absolute inset-0 grid place-items-center overflow-hidden rounded-[22px] bg-white shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)]"
      style={{ backfaceVisibility: 'hidden', transform: back ? 'rotateY(180deg)' : undefined, border: `3px solid ${accent}` }}
    >
      {src ? <img src={src} alt={back ? '' : name} className="size-[86%] object-contain" draggable={false} /> : <span className="size-[70%] rounded-xl bg-gray-100" />}
      <span className="dtd-shine absolute inset-0" aria-hidden />
    </div>
  );

  return (
    <div>
      <div
        className="relative flex h-44 cursor-grab touch-pan-y items-center justify-center overflow-hidden rounded-3xl select-none active:cursor-grabbing sm:h-60"
        style={{ background: `radial-gradient(120% 90% at 50% 100%, ${accent}38, transparent 60%), linear-gradient(180deg, #f8fafc, #eef2f6)`, perspective: '900px' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="img"
        aria-label={`${name}: döndürmek için sürükleyin`}
      >
        <div className="absolute bottom-5 h-5 w-40 rounded-[50%] blur-md" ref={shadow} style={{ background: 'rgba(15,23,42,0.28)' }} aria-hidden />
        <div className="absolute bottom-3 h-8 w-52 rounded-[50%] opacity-70 blur-xl" style={{ background: accent }} aria-hidden />
        <div className="dtd-float">
          <div ref={card} className="relative size-32 sm:size-44" style={{ transformStyle: 'preserve-3d' }}>
            {face(false)}
            {face(true)}
          </div>
        </div>
        <span className="absolute top-2 right-3 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-gray-600">↻ 360°</span>
      </div>
      {images.length > 1 && (
        <div className="dtd-scroll-x mt-2 flex gap-2 overflow-x-auto">
          {images.slice(0, 8).map((im, i) => (
            <button
              key={im}
              type="button"
              onClick={() => setIdx(i)}
              className="size-12 shrink-0 overflow-hidden rounded-xl border-2 bg-white"
              style={{ borderColor: i === idx ? accent : 'transparent' }}
              aria-label={`Görsel ${i + 1}`}
            >
              <img src={im} alt="" className="size-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ürün kartı

export function ProductSheet({
  product,
  accent,
  related,
  inStore,
  onPick,
  onClose,
  onInset,
}: {
  product: ProductInfo;
  accent: string;
  related: InteriorProduct[];
  /** Ürün bu mağaza içinde: "Rafta göster" çıkar */
  inStore: boolean;
  onPick: (productId: string) => void;
  onClose: () => void;
  /** Dar ekranda kartın örttüğü alt yükseklik (px): 3D görüntü yukarı kayar, ürün görünür kalır */
  onInset?: (px: number) => void;
}) {
  const items = useCart();
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !onInset) return;
    const measure = () => onInset(window.innerWidth < 640 ? Math.max(0, window.innerHeight - el.getBoundingClientRect().top) : 0);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      ro.disconnect();
      onInset(0);
    };
  }, [onInset]);
  const inCart = items.find((i) => i.product_id === product.id)?.qty ?? 0;
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [more, setMore] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);
  const discounted = product.price && product.price.list_minor > product.price.final_minor;
  const desc = useMemo(() => plainText(product.description_html ?? ''), [product.description_html]);

  useEffect(() => {
    setQty(1);
    setAdded(false);
    setMore(false);
  }, [product.id]);

  const add = () => {
    cart.add(
      {
        product_id: product.id,
        store_slug: product.store.slug,
        store_name: product.store.name,
        name: product.name,
        image: product.images[0] ?? null,
        price: product.price ? { final_minor: product.price.final_minor, list_minor: product.price.list_minor, currency: product.price.currency } : null,
        in_stock: product.in_stock,
      },
      qty,
    );
    track('cart_add', { product_id: product.id, store_id: product.store.id, surface: '3d', qty });
    if (imgRef.current && product.images[0]) flyToCart(imgRef.current.getBoundingClientRect(), product.images[0]);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  return (
    <section
      ref={sheetRef}
      aria-label="Ürün"
      className="dtd-sheet absolute inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 max-h-[min(62dvh,calc(100dvh-150px))] overflow-y-auto rounded-t-3xl bg-white p-4 text-black shadow-[0_-12px_40px_rgba(0,0,0,0.25)] sm:inset-x-auto sm:top-28 sm:right-3 sm:bottom-[84px] sm:max-h-none sm:w-[400px] sm:rounded-3xl"
    >
      <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-gray-300 sm:hidden" aria-hidden />
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold" style={{ color: accent }}>
            {product.store.name}
            {product.brand?.name ? ` · ${product.brand.name}` : ''}
          </p>
          <h2 className="line-clamp-2 text-base leading-snug font-bold">{product.name}</h2>
        </div>
        <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-600" aria-label="Kapat">
          ✕
        </button>
      </div>

      <div ref={imgRef}>
        <ShowcaseSpin images={product.images} accent={accent} name={product.name} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-extrabold tracking-tight">{price(product.price)}</p>
          {discounted && <p className="text-sm text-gray-500 line-through">{formatMinor(product.price!.list_minor, product.price!.currency)}</p>}
          <p className={`mt-0.5 text-xs font-semibold ${product.in_stock ? 'text-green-700' : 'text-amber-700'}`}>{product.in_stock ? '● Stokta' : '● Stokta yok'}</p>
        </div>
        {product.in_stock && (
          <div className="flex items-center rounded-full bg-gray-100 p-1" role="group" aria-label="Adet">
            <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-lg font-bold shadow-sm disabled:opacity-40" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Azalt">
              −
            </button>
            <span className="w-8 text-center text-sm font-bold" aria-live="polite">
              {qty}
            </span>
            <button type="button" className="grid size-9 place-items-center rounded-full bg-white text-lg font-bold shadow-sm disabled:opacity-40" onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))} disabled={qty >= MAX_QTY} aria-label="Artır">
              +
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={add}
          disabled={!product.in_stock}
          className="relative flex-1 overflow-hidden rounded-2xl px-4 py-3.5 text-sm font-bold text-white shadow-lg transition active:scale-[0.98] disabled:bg-gray-300 disabled:shadow-none"
          style={product.in_stock ? { background: accent } : undefined}
        >
          {product.in_stock ? (added ? '✓ Sepete eklendi' : inCart ? `Sepete ekle (sepette ${inCart})` : 'Sepete ekle') : 'Stokta yok'}
        </button>
        <a href={`/r/${product.id}?ch=3d`} target="_blank" rel="nofollow noopener" className="grid place-items-center rounded-2xl border-2 px-3 text-xs font-bold" style={{ borderColor: accent, color: accent }}>
          Hemen
          <br />
          satın al ↗
        </a>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link href={`/urun/${product.id}`} className="font-semibold text-gray-700 underline underline-offset-2">
          Ürün sayfası
        </Link>
        {product.primary_category?.name && <span className="text-gray-500">{product.primary_category.name}</span>}
      </div>

      {desc && (
        <div className="mt-3 rounded-2xl bg-gray-50 p-3 text-sm text-gray-700">
          <p className={more ? '' : 'line-clamp-3'}>{desc}</p>
          {desc.length > 160 && (
            <button type="button" className="mt-1 text-xs font-semibold" style={{ color: accent }} onClick={() => setMore((m) => !m)}>
              {more ? 'Daha az' : 'Devamını oku'}
            </button>
          )}
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">{inStore ? 'Aynı koridordan' : 'Benzer ürünler'}</p>
          <div className="dtd-scroll-x -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
            {related.map((p) => (
              <button key={p.id} type="button" onClick={() => onPick(p.id)} className="w-28 shrink-0 rounded-2xl border border-gray-200 bg-white p-2 text-left transition active:scale-95">
                {p.thumb ? <img src={p.thumb} alt="" className="h-20 w-full rounded-xl object-contain" loading="lazy" /> : <span className="block h-20 rounded-xl bg-gray-100" />}
                <span className="mt-1 line-clamp-2 text-[11px] leading-tight">{p.name}</span>
                <span className="text-xs font-bold" style={{ color: accent }}>
                  {p.in_stock ? price(p.price) : 'Stokta yok'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ alt sepet çubuğu

export function CartBar({ accent, inside, onOpen }: { accent: string; inside: boolean; onOpen: () => void }) {
  const items = useCart();
  const count = countOf(items);
  const total = subtotal(items);
  const [bump, setBump] = useState(0);
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) setBump((b) => b + 1);
    prev.current = count;
  }, [count]);
  if (!inside && count === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pb-[calc(10px+env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={onOpen}
        className="pointer-events-auto mx-auto flex h-[58px] w-full max-w-xl items-center gap-3 rounded-2xl bg-white/95 pr-2 pl-3 text-left text-black shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur"
        aria-label={`Sepet: ${count} ürün`}
      >
        <span id={CART_TARGET} key={bump} className={`relative grid size-10 shrink-0 place-items-center rounded-xl text-white ${bump ? 'dtd-bump' : ''}`} style={{ background: accent }}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="10" cy="20" r="1.3" />
            <circle cx="17" cy="20" r="1.3" />
          </svg>
          {count > 0 && <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold ring-2 ring-white">{count > 99 ? '99+' : count}</span>}
        </span>
        <span className="min-w-0 flex-1">
          {count === 0 ? (
            <>
              <span className="block text-sm font-semibold">Sepetiniz boş</span>
              <span className="block truncate text-xs text-gray-500">Bir ürüne dokunun ve sepete ekleyin</span>
            </>
          ) : (
            <>
              <span className="block truncate text-sm font-extrabold">{total ? formatMinor(total.minor, total.currency) : 'Sepetim'}</span>
              <span className="flex items-center gap-1">
                <span className="mr-1 text-xs text-gray-600">{count} ürün</span>
                {items.slice(0, 5).map((i) => (
                  <span key={i.product_id} className="size-5 overflow-hidden rounded-md bg-gray-100 ring-1 ring-gray-200">
                    {i.image && <img src={i.image} alt="" className="size-full object-cover" />}
                  </span>
                ))}
                {items.length > 5 && <span className="text-[11px] text-gray-500">+{items.length - 5}</span>}
              </span>
            </>
          )}
        </span>
        {count > 0 && (
          <span className="shrink-0 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white" style={{ background: accent }}>
            Sepete git
          </span>
        )}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ sepet

export function CartDrawer({ accent, currentStore, onClose, onLocate }: { accent: string; currentStore: string | null; onClose: () => void; onLocate: (id: string) => void }) {
  const items = useCart();
  const groups = groupByStore(items);
  const [checkout, setCheckout] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  // Açılışta canlı fiyat/stok (K41, K48)
  useEffect(() => {
    const ids = cart.items().map((i) => i.product_id);
    if (!ids.length) return;
    let off = false;
    void (async () => {
      const live = new Map<string, { price: CartItem['price']; in_stock: boolean }>();
      for (let k = 0; k < ids.length; k += 100) {
        const r = await fetch(`/api/v1/live/prices?ids=${ids.slice(k, k + 100).join(',')}`).catch(() => null);
        if (!r?.ok) continue;
        const j = (await r.json()) as { items: { product_id: string; price: CartItem['price']; in_stock: boolean }[] };
        for (const it of j.items) live.set(it.product_id, { price: it.price ? { final_minor: it.price.final_minor, list_minor: it.price.list_minor, currency: it.price.currency } : null, in_stock: it.in_stock });
      }
      if (!off && live.size) cart.applyLive(live);
    })();
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startCheckout = (g: (typeof groups)[number]) => {
    track('cart_checkout', { items: g.items.length });
    setCheckout(g.store_slug);
  };

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center" onClick={onClose} role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Sepet"
        onClick={(e) => e.stopPropagation()}
        className="dtd-sheet flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white text-black shadow-2xl sm:rounded-3xl"
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-lg font-extrabold">Sepetim</h2>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-gray-100 text-gray-600" aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groups.length === 0 && <p className="py-10 text-center text-sm text-gray-500">Sepetiniz boş. Raflardaki bir ürüne dokunup sepete ekleyin.</p>}
          {groups.map((g) => {
            const t = subtotal(g.items);
            const inCheckout = checkout === g.store_slug;
            return (
              <div key={g.store_slug} className="mb-4 rounded-2xl border border-gray-200 p-3">
                <p className="mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">{g.store_name}</p>
                <ul className="space-y-3">
                  {g.items.map((i) => (
                    <li key={i.product_id} className="flex gap-3">
                      <button
                        type="button"
                        className="size-16 shrink-0 overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200 disabled:cursor-default"
                        onClick={() => onLocate(i.product_id)}
                        disabled={currentStore !== g.store_slug}
                        title={currentStore === g.store_slug ? 'Rafta göster' : undefined}
                      >
                        {i.image && <img src={i.image} alt="" className="size-full object-contain" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm leading-snug">{i.name}</p>
                        <p className="text-sm font-bold">
                          {i.price ? formatMinor(i.price.final_minor * i.qty, i.price.currency) : 'Fiyat sitede'}
                          {i.price && i.qty > 1 && <span className="ml-1 text-xs font-normal text-gray-500">({formatMinor(i.price.final_minor, i.price.currency)} × {i.qty})</span>}
                        </p>
                        {!i.in_stock && <p className="text-xs font-semibold text-amber-700">Şu an stokta yok</p>}
                        {inCheckout ? (
                          <a
                            href={`/r/${i.product_id}?ch=3d`}
                            target="_blank"
                            rel="nofollow noopener"
                            onClick={() => setOpened((s) => new Set(s).add(i.product_id))}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
                            style={{ background: opened.has(i.product_id) ? '#16a34a' : accent }}
                          >
                            {opened.has(i.product_id) ? '✓ Sitede açıldı' : `Sitede sepete ekle (${i.qty} adet) ↗`}
                          </a>
                        ) : (
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex items-center rounded-full bg-gray-100 p-0.5">
                              <button type="button" className="grid size-7 place-items-center rounded-full bg-white font-bold shadow-sm" onClick={() => cart.setQty(i.product_id, i.qty - 1)} aria-label="Azalt">
                                −
                              </button>
                              <span className="w-7 text-center text-xs font-bold">{i.qty}</span>
                              <button
                                type="button"
                                className="grid size-7 place-items-center rounded-full bg-white font-bold shadow-sm disabled:opacity-40"
                                onClick={() => cart.setQty(i.product_id, i.qty + 1)}
                                disabled={i.qty >= MAX_QTY}
                                aria-label="Artır"
                              >
                                +
                              </button>
                            </div>
                            <button type="button" className="text-xs text-gray-500 underline" onClick={() => cart.remove(i.product_id)}>
                              Kaldır
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-gray-100 pt-3">
                  {t && (
                    <p className="flex items-baseline justify-between text-sm">
                      <span className="text-gray-600">Tahmini ara toplam</span>
                      <span className="text-lg font-extrabold">{formatMinor(t.minor, t.currency)}</span>
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
                    Ödeme {g.store_name} sitesinde yapılır; kesin tutar, kargo ve indirimler orada hesaplanır.{t?.partial ? ' Fiyatı sitede olan ürünler toplama dahil değil.' : ''}
                  </p>
                  {inCheckout ? (
                    <div className="mt-2 rounded-xl bg-gray-50 p-2.5 text-xs text-gray-700">
                      Her ürün {g.store_name} sitesinde yeni sekmede açılır; orada sepete ekleyip ödemeyi tamamlayın.
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="flex-1 rounded-xl bg-gray-900 px-3 py-2 font-bold text-white" onClick={() => (cart.clearStore(g.store_slug), setCheckout(null))}>
                          Tamamladım, sepeti boşalt
                        </button>
                        <button type="button" className="rounded-xl border border-gray-300 px-3 py-2 font-semibold" onClick={() => setCheckout(null)}>
                          Geri
                        </button>
                      </div>
                    </div>
                  ) : g.items.length === 1 ? (
                    <a
                      href={`/r/${g.items[0]!.product_id}?ch=3d`}
                      target="_blank"
                      rel="nofollow noopener"
                      onClick={() => track('cart_checkout', { items: 1 })}
                      className="mt-2 block rounded-2xl px-4 py-3 text-center text-sm font-bold text-white shadow-lg"
                      style={{ background: accent }}
                    >
                      Siparişi {g.store_name} sitesinde tamamla ↗
                    </a>
                  ) : (
                    <button type="button" onClick={() => startCheckout(g)} className="mt-2 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-lg" style={{ background: accent }}>
                      Siparişi {g.store_name} sitesinde tamamla
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ efektler

/** Ürün görseli kavis çizerek sepet simgesine uçar; varışta simge zıplar ve konfeti saçılır */
export function flyToCart(from: DOMRect, src: string) {
  const target = document.getElementById(CART_TARGET)?.getBoundingClientRect();
  if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const size = Math.min(from.width, from.height, 160);
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  Object.assign(img.style, {
    position: 'fixed',
    left: `${from.left + from.width / 2 - size / 2}px`,
    top: `${from.top + from.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    objectFit: 'contain',
    background: '#fff',
    borderRadius: '20px',
    boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
    zIndex: '60',
    pointerEvents: 'none',
  });
  document.body.appendChild(img);
  const dx = target.left + target.width / 2 - (from.left + from.width / 2);
  const dy = target.top + target.height / 2 - (from.top + from.height / 2);
  const anim = img.animate(
    [
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${Math.min(dy * 0.3, -60)}px) scale(0.62) rotate(-12deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(8deg)`, opacity: 0.6 },
    ],
    { duration: 780, easing: 'cubic-bezier(0.45, 0, 0.3, 1)' },
  );
  anim.onfinish = () => {
    img.remove();
    confetti(target.left + target.width / 2, target.top + target.height / 2);
  };
}

function confetti(x: number, y: number) {
  const colors = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#facc15'];
  for (let i = 0; i < 18; i++) {
    const d = document.createElement('span');
    const s = 5 + Math.random() * 5;
    Object.assign(d.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      width: `${s}px`,
      height: `${s * (Math.random() > 0.5 ? 1 : 0.45)}px`,
      background: colors[i % colors.length]!,
      borderRadius: Math.random() > 0.5 ? '50%' : '2px',
      zIndex: '61',
      pointerEvents: 'none',
    });
    document.body.appendChild(d);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const r = 40 + Math.random() * 60;
    d.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r + 30}px)) rotate(${Math.random() * 540}deg)`, opacity: 0 },
      ],
      { duration: 650 + Math.random() * 300, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
    ).onfinish = () => d.remove();
  }
}

/** Kaynak açıklamasından düz metin (HTML çalıştırılmaz; DOMParser betik çalıştırmaz) */
function plainText(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 1200);
}
