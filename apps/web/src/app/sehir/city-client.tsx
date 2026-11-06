'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { type Bundle, CityRuntime, type Manifest } from '../../lib/city/city-runtime';
import { type Quality, SETTINGS, degrade, guessQuality, webglAvailable } from '../../lib/city/quality';
import { track } from '../../lib/analytics/client';
import { formatMinor } from '../../lib/format';

interface ProductInfo {
  id: string;
  name: string;
  price: { final_minor: number; list_minor: number; currency: string } | null;
  in_stock: boolean;
  store: { slug: string; name: string };
  images: string[];
}

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
    if (s) runtimeRef.current?.teleport(s.entrance[0], s.entrance[2] + 6, [s.entrance[0], s.entrance[2] - 10]);
  }, [startStore, bundles]);

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

      {menu && (
        <nav aria-label="Hızlı seyahat" className="absolute top-16 right-3 max-h-[70vh] w-64 overflow-y-auto rounded-lg bg-white p-3 text-sm text-black shadow-xl">
          <p className="text-xs font-semibold text-gray-600 uppercase">Mağazalar</p>
          <ul className="mt-1 space-y-1">
            {stores.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left hover:bg-gray-100"
                  onClick={() => {
                    runtimeRef.current?.teleport(s.entrance[0], s.entrance[2] + 6, [s.entrance[0], s.entrance[2] - 10]);
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

      {product && (
        <section aria-label="Ürün" className="absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-xl bg-white p-4 text-black shadow-2xl sm:inset-x-auto sm:right-3">
          <div className="flex gap-3">
            {product.images[0] && <img src={product.images[0]} alt="" width={80} height={80} className="size-20 rounded object-contain" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-600">{product.store.name}</p>
              <h2 className="line-clamp-2 font-semibold">{product.name}</h2>
              <p className="mt-1 text-lg font-semibold">{product.price ? formatMinor(product.price.final_minor, product.price.currency) : 'Fiyat sitede'}</p>
              <p className={`text-xs ${product.in_stock ? 'text-green-700' : 'text-amber-700'}`}>{product.in_stock ? 'Stokta' : 'Stokta yok'}</p>
            </div>
            <button type="button" onClick={() => setProduct(null)} className="self-start text-gray-500" aria-label="Kapat">
              ✕
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <a href={`/r/${product.id}?ch=3d`} target="_blank" rel="nofollow noopener" className="flex-1 rounded-md bg-teal-700 px-3 py-2 text-center text-sm font-medium text-white">
              Sitede satın al
            </a>
            <Link href={`/urun/${product.id}`} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
              Ayrıntı
            </Link>
          </div>
        </section>
      )}

      {suggest2d && (
        <div role="status" className="absolute inset-x-3 top-16 mx-auto max-w-sm rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
          Cihazınızda 3D yavaş çalışıyor. <Link href="/" className="font-semibold underline">2D görünüme geçin</Link>.
        </div>
      )}

      {isTouch && phase.kind === 'ready' && <Joystick onChange={(f, s) => runtimeRef.current?.setJoystick(f, s)} />}

      <p className="pointer-events-none absolute bottom-3 left-3 hidden rounded bg-black/50 px-2 py-1 text-xs text-white sm:block">
        W A S D / oklar: yürü · Shift: koş · sürükle: bak · panoya tıkla: ürün · kalite: {quality}
      </p>
    </div>
  );
}

/** Mobil sanal joystick (sol alt): sürükleme yönü yürüme girdisi olur. */
function Joystick({ onChange }: { onChange: (forward: number, strafe: number) => void }) {
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
      className="absolute bottom-6 left-6 size-32 rounded-full bg-white/20 ring-2 ring-white/40"
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
