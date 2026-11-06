'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Bundle, CityRuntime, type Manifest, type StoreRef } from '../../lib/city/city-runtime';
import type { InteriorData } from '../../lib/city/interior';
import { type Quality, SETTINGS, degrade, guessQuality, webglAvailable } from '../../lib/city/quality';
import { track } from '../../lib/analytics/client';
import { useCart } from '../../lib/cart';
import { CartBar, CartDrawer, type ProductInfo, ProductSheet, StoreHud, WelcomeToast } from './store-ui';

type Phase = { kind: 'loading' } | { kind: 'no3d'; reason: string } | { kind: 'ready' } | { kind: 'error'; message: string };

/** 3D şehir (F4.2, K04, K12, K48). WebGL yoksa ya da cihaz yetmezse 2D'ye düşülür, hata ekranı yok. */
export function CityClient({ worldSlug, startStore }: { worldSlug: string; startStore?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<CityRuntime | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [quality, setQuality] = useState<Quality>('medium');
  const [region, setRegion] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [menu, setMenu] = useState(false);
  const [riding, setRiding] = useState(false);
  const [suggest2d, setSuggest2d] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const [nearStore, setNearStore] = useState<StoreRef | null>(null);
  const [inside, setInside] = useState<InteriorData | 'loading' | null>(null);
  const [accent, setAccent] = useState('#0f766e');
  const [cartOpen, setCartOpen] = useState(false);
  const cartItems = useCart();
  const qualityRef = useRef<Quality>('medium');

  useEffect(() => {
    if (!webglAvailable()) {
      setPhase({ kind: 'no3d', reason: 'Tarayıcınız 3D grafikleri (WebGL) desteklemiyor.' });
      return;
    }
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
    const touch = window.matchMedia('(pointer: coarse)').matches;
    setIsTouch(touch);
    const q = guessQuality({
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      saveData: nav.connection?.saveData,
      effectiveType: nav.connection?.effectiveType,
      mobile: touch,
    });
    qualityRef.current = q;
    setQuality(q);
    let disposed = false;
    void fetch(`/api/v1/worlds/${worldSlug}`)
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => {
        if (disposed || !canvasRef.current) return;
        if (!m.regions.some((r) => r.bundle_url)) {
          setPhase({ kind: 'no3d', reason: 'Şehir henüz yayında değil.' });
          return;
        }
        setManifest(m);
        const rt = new CityRuntime(canvasRef.current, m, SETTINGS[q], {
          onProduct: (id) => void openProduct(id),
          onRegion: (name) => {
            setRegion(name);
            const r = name ? m.regions.find((x) => x.name === name) : undefined;
            if (r) track('region_enter', { world: worldSlug, region: r.slug });
          },
          onBundles: setBundles,
          onRide: setRiding,
          onNearStore: setNearStore,
          onInterior: (st, color) => {
            setInside(st);
            if (color) setAccent(color);
            setProduct(null);
            setCartOpen(false);
            if (st && st !== 'loading') track('store_enter', { store_id: st.store.id, surface: '3d' });
          },
          onFps: (fps) => {
            const d = degrade(qualityRef.current, fps);
            if (d.quality !== qualityRef.current) {
              qualityRef.current = d.quality;
              setQuality(d.quality);
              rt.applySettings(SETTINGS[d.quality]);
            }
            if (d.suggest2d) setSuggest2d(true);
          },
        });
        runtimeRef.current = rt;
        // Geliştirmede kamera/ışık ayarı için konsoldan erişim (üretim derlemesinde yok)
        if (process.env.NODE_ENV !== 'production') (window as unknown as { __dtdCity?: CityRuntime }).__dtdCity = rt;
        setPhase({ kind: 'ready' });
        track('world_enter', { world: worldSlug, quality: q });
      })
      .catch(() => setPhase({ kind: 'error', message: 'Şehir yüklenemedi.' }));
    return () => {
      disposed = true;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [worldSlug]);

  // Haritadan gelinen mağaza: paketi yüklenince girişine ışınla
  useEffect(() => {
    if (!startStore) return;
    const s = bundles.flatMap((b) => b.stores).find((x) => x.slug === startStore);
    if (s) runtimeRef.current?.teleport(s.entrance[0], s.entrance[2] + 10.5, [s.entrance[0], s.entrance[2] - 10]);
  }, [startStore, bundles]);

  // Sepetteki ürünler raflarda rozetle; açık ürün rafta nabız gibi atan çerçeveyle
  useEffect(() => {
    runtimeRef.current?.setCart(new Map(cartItems.map((i) => [i.product_id, i.qty])));
  }, [cartItems, inside]);
  useEffect(() => {
    runtimeRef.current?.selectProduct(product?.id ?? null);
  }, [product, inside]);

  const insideData = inside && inside !== 'loading' ? inside : null;
  // Ürün kartında "Aynı koridordan": ürünün bölümündeki diğer ürünler (stokta olanlar önce)
  const related = useMemo(() => {
    if (!insideData || !product) return [];
    const sec = insideData.sections.find((s) => s.products.some((p) => p.id === product.id));
    if (!sec) return insideData.featured.filter((p) => p.id !== product.id);
    return sec.products
      .filter((p) => p.id !== product.id)
      .sort((a, b) => Number(b.in_stock) - Number(a.in_stock))
      .slice(0, 12);
  }, [insideData, product]);

  const setInset = useCallback((px: number) => runtimeRef.current?.setBottomInset(px), []);

  /** Arama/sepet/benzer ürün: ürünü aç ve rafına yürü */
  function showProduct(id: string) {
    void openProduct(id);
    runtimeRef.current?.focusProduct(id);
  }

  async function openProduct(id: string) {
    try {
      const [p, live] = await Promise.all([
        fetch(`/api/v1/products/${id}`).then((r) => (r.ok ? (r.json() as Promise<ProductInfo>) : null)),
        fetch(`/api/v1/live/prices?ids=${id}`).then((r) => (r.ok ? r.json() : { items: [] })),
      ]);
      if (!p) return;
      track('product_view', { product_id: p.id, surface: '3d' });
      const l = (live as { items: { price: ProductInfo['price']; in_stock: boolean }[] }).items[0];
      setProduct({ ...p, price: l?.price ?? p.price, in_stock: l?.in_stock ?? p.in_stock });
    } catch {
      /* ağ hatasında kart açılmaz */
    }
  }

  const stores = bundles.flatMap((b) => b.stores);
  const stations = manifest?.transit_lines.flatMap((l) => l.stations).filter((s) => s.position) ?? [];

  if (phase.kind === 'no3d' || phase.kind === 'error') {
    return <Fallback2d reason={phase.kind === 'no3d' ? phase.reason : phase.message} />;
  }

  return (
    <div className="fixed inset-0 bg-black select-none" style={{ touchAction: 'none' }}>
      <canvas ref={canvasRef} className="h-full w-full" aria-label="3D şehir: sürükleyerek bak, W A S D ya da oklarla yürü, panolara dokun" />
      {phase.kind === 'loading' && <p className="absolute inset-x-0 top-1/2 text-center text-white">Şehir yükleniyor…</p>}

      {insideData ? (
        <StoreHud
          key={insideData.store.id}
          data={insideData}
          accent={accent}
          onSection={(i) => (setProduct(null), runtimeRef.current?.focusSection(i))}
          onPick={showProduct}
          onExit={() => runtimeRef.current?.exitStore()}
        />
      ) : (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto rounded-lg bg-black/60 px-3 py-2 text-sm text-white">
            <p className="font-semibold">{region ?? manifest?.world.name ?? 'Şehir'}</p>
            {riding && <p className="text-xs text-amber-300">Tramvaydasınız…</p>}
          </div>
          <div className="pointer-events-auto flex gap-2">
            <button type="button" onClick={() => setMenu((m) => !m)} className="rounded-lg bg-white/90 px-3 py-2 text-sm font-medium text-black" aria-expanded={menu}>
              Nereye?
            </button>
            <Link href="/" className="rounded-lg bg-white/90 px-3 py-2 text-sm font-medium text-black">
              2D görünüm
            </Link>
          </div>
        </div>
      )}
      {insideData && <WelcomeToast key={`hi-${insideData.store.id}`} data={insideData} accent={accent} />}

      {menu && !insideData && (
        <nav aria-label="Hızlı seyahat" className="absolute top-16 right-3 max-h-[70vh] w-64 overflow-y-auto rounded-lg bg-white p-3 text-sm text-black shadow-xl">
          <p className="text-xs font-semibold text-gray-600 uppercase">Mağazalar</p>
          <ul className="mt-1 space-y-1">
            {stores.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left hover:bg-gray-100"
                  onClick={() => {
                    runtimeRef.current?.teleport(s.entrance[0], s.entrance[2] + 10.5, [s.entrance[0], s.entrance[2] - 10]);
                    setMenu(false);
                  }}
                >
                  {s.name}
                </button>
              </li>
            ))}
            {stores.length === 0 && <li className="text-gray-500">Mağazalar yükleniyor…</li>}
          </ul>
          <p className="mt-3 text-xs font-semibold text-gray-600 uppercase">Tramvay durakları</p>
          <ul className="mt-1 space-y-1">
            {stations.map((s) => (
              <li key={s.place_id} className="flex gap-1">
                <button type="button" className="flex-1 rounded px-2 py-1 text-left hover:bg-gray-100" onClick={() => (runtimeRef.current?.rideTo(s.position!), setMenu(false))}>
                  🚋 {s.name}
                </button>
                <button type="button" className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" title="Işınlan" onClick={() => (runtimeRef.current?.teleport(s.position![0], s.position![2] + 4), setMenu(false))}>
                  ⇢
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {phase.kind === 'ready' && !product && !insideData && (inside === 'loading' || nearStore) && (
        <div className={`pointer-events-none absolute inset-x-0 flex justify-center ${cartItems.length ? 'bottom-[150px] sm:bottom-[90px]' : 'bottom-24 sm:bottom-14'}`}>
          {inside === 'loading' ? (
            <p className="rounded-full bg-black/70 px-4 py-2 text-sm text-white" role="status">
              Mağaza açılıyor…
            </p>
          ) : (
            nearStore && (
              <button
                type="button"
                onClick={() => void runtimeRef.current?.enterStore(nearStore.slug)}
                className="pointer-events-auto rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
              >
                {nearStore.name} — içeri gir
              </button>
            )
          )}
        </div>
      )}

      {product && (
        <ProductSheet
          product={product}
          accent={insideData ? accent : '#0f766e'}
          related={related}
          inStore={!!insideData}
          onPick={showProduct}
          onClose={() => setProduct(null)}
          onInset={setInset}
        />
      )}

      <CartBar accent={insideData ? accent : '#0f766e'} inside={!!insideData} onOpen={() => (setProduct(null), setCartOpen(true))} />
      {cartOpen && (
        <CartDrawer
          accent={insideData ? accent : '#0f766e'}
          currentStore={insideData?.store.slug ?? null}
          onClose={() => setCartOpen(false)}
          onLocate={(id) => (setCartOpen(false), showProduct(id))}
        />
      )}

      {suggest2d && (
        <div role="status" className="absolute inset-x-3 top-16 mx-auto max-w-sm rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
          Cihazınızda 3D yavaş çalışıyor. <Link href="/" className="font-semibold underline">2D görünüme geçin</Link>.
        </div>
      )}

      {isTouch && phase.kind === 'ready' && !product && !cartOpen && <Joystick raised={!!insideData || cartItems.length > 0} onChange={(f, s) => runtimeRef.current?.setJoystick(f, s)} />}

      <p className={`pointer-events-none absolute left-3 hidden rounded bg-black/50 px-2 py-1 text-xs text-white sm:block ${insideData || cartItems.length ? 'bottom-[84px]' : 'bottom-3'}`}>
        W A S D / oklar: yürü · Shift: koş · sürükle: bak · {inside ? 'raflara yaklaş, ürüne tıkla' : 'panoya tıkla: ürün · kapıya yürü: içeri gir'} · kalite: {quality}
      </p>
    </div>
  );
}

/** Mobil sanal joystick (sol alt): sürükleme yönü yürüme girdisi olur. */
function Joystick({ onChange, raised }: { onChange: (forward: number, strafe: number) => void; raised: boolean }) {
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const R = 48;
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = e.clientX - (rect.left + rect.width / 2);
    let y = e.clientY - (rect.top + rect.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) {
      x = (x / d) * R;
      y = (y / d) * R;
    }
    setKnob([x, y]);
    onChange(-y / R, x / R);
  };
  const end = () => {
    setKnob([0, 0]);
    onChange(0, 0);
  };
  return (
    <div
      className={`absolute left-6 size-32 rounded-full bg-white/20 ring-2 ring-white/40 ${raised ? 'bottom-[92px]' : 'bottom-6'}`}
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), move(e))}
      onPointerMove={(e) => e.buttons && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
      role="presentation"
    >
      <div className="absolute top-1/2 left-1/2 size-12 rounded-full bg-white/80" style={{ transform: `translate(calc(-50% + ${knob[0]}px), calc(-50% + ${knob[1]}px))` }} />
    </div>
  );
}

/** K12: 3D açılamıyorsa hata ekranı yerine 2D seçenekleri. */
function Fallback2d({ reason }: { reason: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">2D görünümle devam edin</h1>
      <p className="mt-2 text-muted">{reason}</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">
          Mağazalar
        </Link>
        <Link href="/harita" className="rounded-md border border-line px-4 py-2">
          Türkiye haritası
        </Link>
      </div>
    </main>
  );
}
