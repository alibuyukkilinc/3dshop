import {
  ANALYTICS_BATCH_MAX,
  type AnalyticsEventName,
  type AnalyticsEventProps,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_DAYS,
  type Consent,
  GA4_ID_RE,
  consentDay,
  decodeConsent,
  encodeConsent,
  uuidv7,
} from '@dtd/contracts';

/**
 * Tarayıcı analitiği (K15, F5.4). KVKK: varsayılan red. Rıza yoksa hiçbir olay kuyruğa girmez, oturum kimliği
 * üretilmez, Google betiği yüklenmez. analytics rızası → platform olayları (/api/v1/events, yurt içi);
 * ga4 rızası → Google Analytics (yurt dışına aktarım). Olaylar 20'lik paketlerle; sayfa kapanırken keepalive.
 */
const SID_KEY = 'dtd_sid';
const FLUSH_MS = 3_000;
export const CONSENT_CHANGED = 'dtd:consent';
export const OPEN_CONSENT = 'dtd:open-consent';

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    [k: `ga-disable-${string}`]: boolean | undefined;
  }
}

let ga4Id: string | null = null;
let ga4Loaded = false;
let queue: { name: AnalyticsEventName; props: unknown }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function readConsent(): Consent | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return decodeConsent(raw ? decodeURIComponent(raw) : null);
}

/** Karar gerekiyor mu: hiç karar yok ya da GA4 sonradan açıldı ve bu ziyaretçiye hiç sorulmadı. */
export function needsDecision(c: Consent | null, ga4Available: boolean): boolean {
  return c === null || (ga4Available && c.ga4 === null);
}

export function saveConsent(analytics: boolean, ga4: boolean | null): Consent {
  const c: Consent = { analytics, ga4, decidedAt: consentDay() };
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${encodeConsent(c)}; Max-Age=${CONSENT_MAX_AGE_DAYS * 86_400}; Path=/; SameSite=Lax${secure}`;
  apply(c);
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED, { detail: c }));
  return c;
}

/** Sağlayıcı açılışında: GA4 kimliği ve mevcut rıza uygulanır. */
export function initAnalytics(measurementId: string | null) {
  ga4Id = measurementId && GA4_ID_RE.test(measurementId) ? measurementId : null;
  apply(readConsent());
  window.addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function apply(c: Consent | null) {
  if (!c?.analytics) {
    // Rıza geri alındı: bekleyen olaylar ve oturum kimliği silinir
    queue = [];
    try {
      sessionStorage.removeItem(SID_KEY);
    } catch {
      /* depolama kapalı */
    }
  }
  if (ga4Id) {
    const granted = c?.ga4 === true;
    window[`ga-disable-${ga4Id}`] = !granted;
    if (granted) loadGa4(ga4Id);
    else if (ga4Loaded) {
      window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      clearGaCookies();
    }
  }
}

function loadGa4(id: string) {
  if (ga4Loaded) {
    window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    return;
  }
  ga4Loaded = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js dizi değil arguments nesnesi bekler
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  // Reklam depolaması hiç açılmaz; yalnız analitik (açık rıza ile)
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
  window.gtag('js', new Date());
  window.gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

function clearGaCookies() {
  const host = location.hostname;
  const domains = ['', host, `.${host.split('.').slice(-2).join('.')}`];
  for (const c of document.cookie.split('; ')) {
    const name = c.split('=')[0]!;
    if (name === '_ga' || name.startsWith('_ga_')) {
      for (const d of domains) document.cookie = `${name}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ''}`;
    }
  }
}

function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id = uuidv7();
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Sözlükteki bir olayı kaydeder. Rıza yoksa sessizce hiçbir şey yapmaz. */
export function track<N extends AnalyticsEventName>(name: N, props: AnalyticsEventProps<N>) {
  if (typeof window === 'undefined') return;
  const c = readConsent();
  if (c?.analytics) {
    queue.push({ name, props });
    if (queue.length >= ANALYTICS_BATCH_MAX) flush();
    else if (!timer) timer = setTimeout(() => flush(), FLUSH_MS);
  }
  if (c?.ga4 && ga4Id && window.gtag) {
    const [gaName, gaParams] = toGa4(name, props as Record<string, unknown>);
    window.gtag('event', gaName, gaParams);
  }
}

/** GA4 önerilen olay adları (view_item, search, page_view); diğerleri aynı adla özel olay. */
export function toGa4(name: AnalyticsEventName, p: Record<string, unknown>): [string, Record<string, unknown>] {
  switch (name) {
    case 'page_view':
      return ['page_view', { page_path: p.path, page_location: location.origin + String(p.path) }];
    case 'product_view':
      return ['view_item', { items: [{ item_id: p.product_id, affiliation: p.store_id }], surface: p.surface }];
    case 'search':
      return ['search', { search_term: p.q }];
    default:
      return [name, p];
  }
}

/** keepalive: sayfa kapanırken de istek tamamlanır (sendBeacon application/json'u her tarayıcıda göndermez). */
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const sid = sessionId();
  if (!sid) {
    queue = [];
    return;
  }
  while (queue.length) {
    const body = JSON.stringify({ session_id: sid, events: queue.splice(0, ANALYTICS_BATCH_MAX) });
    // Analitik hiçbir zaman sayfayı bozmaz: hata yutulur
    void fetch('/api/v1/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
  }
}

/** /r/{ürün}?ch=… bağlantısından outbound_click olayı (kaynak siteye yönlendirme) */
export function outboundFromHref(href: string): AnalyticsEventProps<'outbound_click'> | null {
  const m = /^\/r\/([0-9a-f-]{36})(?:\?ch=(2d|3d|search|ai))?/.exec(href);
  return m ? { product_id: m[1]!, channel: (m[2] as '2d' | '3d' | 'search' | 'ai' | undefined) ?? '2d' } : null;
}
