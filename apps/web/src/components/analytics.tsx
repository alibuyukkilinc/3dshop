'use client';

import type { AnalyticsEventName, AnalyticsEventProps, Consent } from '@dtd/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  CONSENT_CHANGED,
  OPEN_CONSENT,
  initAnalytics,
  needsDecision,
  outboundFromHref,
  readConsent,
  saveConsent,
  track,
} from '../lib/analytics/client';

/**
 * Analitik sağlayıcı + çerez/rıza bandı (KVKK, F5.4). Karar verilene kadar hiçbir analitik çalışmaz.
 * "Kabul et" ile "Reddet" eşit ağırlıktadır (Kurul çerez rehberi: reddetmek kabul etmek kadar kolay olmalı).
 */
export function Analytics({ ga4Id }: { ga4Id: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (!inited.current) {
      inited.current = true;
      initAnalytics(ga4Id);
    }
    const c = readConsent();
    setConsent(c);
    setOpen(needsDecision(c, Boolean(ga4Id)));
    const onOpen = () => {
      setDetails(true);
      setOpen(true);
    };
    const onChange = (e: Event) => setConsent((e as CustomEvent<Consent>).detail);
    // "Sitede satın al" bağlantıları (/r/…): her yüzeyde tek yerden outbound_click
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="/r/"]');
      const p = a ? outboundFromHref(a.getAttribute('href') ?? '') : null;
      if (p) track('outbound_click', p);
    };
    window.addEventListener(OPEN_CONSENT, onOpen);
    window.addEventListener(CONSENT_CHANGED, onChange);
    document.addEventListener('click', onClick, { capture: true });
    return () => {
      window.removeEventListener(OPEN_CONSENT, onOpen);
      window.removeEventListener(CONSENT_CHANGED, onChange);
      document.removeEventListener('click', onClick, { capture: true });
    };
  }, [ga4Id]);

  // Sayfa görüntüleme: yol değişince (sorgu dizesi olmadan; arama terimi ayrı search olayıdır)
  const lastView = useRef('');
  useEffect(() => {
    if (!(consent?.analytics || consent?.ga4)) return;
    // Aynı yol aynı rızayla bir kez (StrictMode ve yeniden çizimde çift sayım olmasın)
    const key = `${pathname}|${consent.analytics}|${consent.ga4}`;
    if (lastView.current === key) return;
    lastView.current = key;
    track('page_view', { path: pathname.slice(0, 200) });
  }, [pathname, consent]);

  if (!open) return null;
  const decide = (analytics: boolean, ga4: boolean) => {
    setConsent(saveConsent(analytics, ga4Id ? ga4 : null));
    setOpen(false);
    setDetails(false);
  };
  return (
    <ConsentBanner
      ga4Available={Boolean(ga4Id)}
      initial={consent}
      details={details}
      onDetails={() => setDetails(true)}
      onDecide={decide}
    />
  );
}

function ConsentBanner({
  ga4Available,
  initial,
  details,
  onDetails,
  onDecide,
}: {
  ga4Available: boolean;
  initial: Consent | null;
  details: boolean;
  onDetails: () => void;
  onDecide: (analytics: boolean, ga4: boolean) => void;
}) {
  const titleId = useId();
  const [analytics, setAnalytics] = useState(initial?.analytics ?? false);
  const [ga4, setGa4] = useState(initial?.ga4 ?? false);
  const btn =
    'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface shadow-[0_-4px_24px_rgba(0,0,0,0.12)]"
    >
      <div className="mx-auto max-w-6xl px-4 py-4">
        <h2 id={titleId} className="font-semibold">
          Çerez tercihleriniz
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Siteyi geliştirmek için hangi sayfaların ve ürünlerin ziyaret edildiğini ölçmek istiyoruz. Adınızı, e-postanızı
          ya da IP adresinizi kaydetmiyoruz. İzin vermezseniz site aynı şekilde çalışır.{' '}
          <Link href="/cerez-politikasi" className="underline">
            Çerez aydınlatma metni
          </Link>
        </p>

        {details && (
          <fieldset className="mt-3 grid gap-2 text-sm">
            <legend className="sr-only">Çerez türleri</legend>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked disabled className="mt-1" />
              <span>
                <strong>Zorunlu</strong> — tercihinizin hatırlanması. Kapatılamaz.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="mt-1" />
              <span>
                <strong>Site istatistikleri</strong> — gezdiğiniz sayfa ve ürünler, kimliğinizle ilişkilendirilmeden
                yalnız bizim sunucularımızda (Türkiye) tutulur, 13 ay sonra silinir.
              </span>
            </label>
            {ga4Available && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={ga4} onChange={(e) => setGa4(e.target.checked)} className="mt-1" />
                <span>
                  <strong>Google Analytics</strong> — aynı ölçüm Google LLC hizmetiyle yapılır; veriler yurt dışına
                  aktarılır. Reklam ve kişiselleştirme kapalıdır.
                </span>
              </label>
            )}
          </fieldset>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {details ? (
            <button type="button" onClick={() => onDecide(analytics, ga4)} className={`${btn} bg-accent text-accent-ink`}>
              Seçimi kaydet
            </button>
          ) : (
            <button type="button" onClick={onDetails} className={`${btn} border border-line`}>
              Tercihler
            </button>
          )}
          <button type="button" onClick={() => onDecide(false, false)} className={`${btn} border border-line`}>
            Tümünü reddet
          </button>
          <button type="button" onClick={() => onDecide(true, true)} className={`${btn} border border-line`}>
            Tümünü kabul et
          </button>
        </div>
      </div>
    </section>
  );
}

/** Altbilgideki "Çerez tercihleri" düğmesi: bandı yeniden açar. */
export function ConsentSettingsButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT))} className="underline hover:no-underline">
      Çerez tercihleri
    </button>
  );
}

/** Sunucu sayfalarından bir kez olay (ör. 2D ürün sayfası → product_view). Rıza yoksa hiçbir şey yapmaz. */
export function TrackOnMount<N extends AnalyticsEventName>({ name, props }: { name: N; props: AnalyticsEventProps<N> }) {
  const key = JSON.stringify(props);
  const fired = useRef('');
  useEffect(() => {
    // StrictMode efekti iki kez çalıştırır; aynı olay aynı bileşende bir kez
    if (fired.current === `${name}|${key}`) return;
    fired.current = `${name}|${key}`;
    track(name, JSON.parse(key) as AnalyticsEventProps<N>);
  }, [name, key]);
  return null;
}
