import { z } from 'zod';

/**
 * Platform olay sözlüğü (K15, K37; Cortex analitik). İstemci yalnız bu olayları gönderir, API aynı şemayla
 * doğrular. Kişisel veri yok: kullanıcı/IP/e-posta alanı tanımlı değil; oturum kimliği tarayıcı oturumluk
 * rastgele UUID'dir ve yalnız rıza verilince üretilir. Yeni olay = buraya ekleme + Cortex analitik düğümü.
 */
const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const Surface = z.enum(['2d', '3d']);
const RedirectChannel = z.enum(['2d', '3d', 'search', 'ai']);

export const ANALYTICS_EVENTS = {
  /** Sayfa açıldı. Yol sorgu dizesi olmadan (arama terimi page_view'a girmez). */
  page_view: z.object({ path: z.string().startsWith('/').max(200) }),
  /** 3D şehir yüklendi. */
  world_enter: z.object({ world: Slug, quality: z.enum(['low', 'medium', 'high']).optional() }),
  /** 3D'de bölgeye girildi. */
  region_enter: z.object({ world: Slug, region: Slug }),
  /** Mağaza açıldı (2D mağaza sayfası). */
  store_enter: z.object({ store_id: Uuid, surface: Surface }),
  /** Ürün açıldı: 2D ürün sayfası ya da 3D ürün kartı. */
  product_view: z.object({ product_id: Uuid, store_id: Uuid.optional(), surface: Surface }),
  /** Arama yapıldı. Terim küçük harfe çevrilip kırpılır; sonuç sayısı. */
  search: z.object({ q: z.string().trim().min(1).max(100), results: z.number().int().min(0).max(1_000_000) }),
  /** AI rehbere soru soruldu (F5.2). Soru metni saklanmaz. */
  ai_question: z.object({ answered: z.boolean() }),
  /** "Sitede satın al" tıklandı (sunucudaki analytics.redirects kaydının istemci tarafı). */
  outbound_click: z.object({ product_id: Uuid, channel: RedirectChannel }),
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsEventProps<N extends AnalyticsEventName> = z.infer<(typeof ANALYTICS_EVENTS)[N]>;
export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

/** Bir istekte en çok olay; istemci kuyruğu da bu boyutta boşaltılır. */
export const ANALYTICS_BATCH_MAX = 20;

const EventSchema = z
  .object({ name: z.enum(ANALYTICS_EVENT_NAMES as [AnalyticsEventName, ...AnalyticsEventName[]]), props: z.unknown() })
  .transform((e, ctx) => {
    const r = ANALYTICS_EVENTS[e.name].safeParse(e.props ?? {});
    if (!r.success) {
      for (const i of r.error.issues) ctx.addIssue({ code: 'custom', message: i.message, path: ['props', ...i.path] });
      return z.NEVER;
    }
    return { name: e.name, props: r.data as Record<string, unknown> };
  });

/** POST /api/v1/events gövdesi. */
export const AnalyticsBatchSchema = z.object({
  session_id: Uuid,
  events: z.array(EventSchema).min(1).max(ANALYTICS_BATCH_MAX),
});
export type AnalyticsBatch = z.input<typeof AnalyticsBatchSchema>;

/**
 * Rıza (KVKK): varsayılan red. analytics = platformun kendi olayları (yurt içi sunucu);
 * ga4 = Google Analytics (yurt dışına aktarım, ayrı açık rıza). Çerez: dtd_consent=v1.<a>.<g>.<gün>, g ∈ 0|1|x
 */
export interface Consent {
  analytics: boolean;
  /** null: karar anında GA4 sunulmuyordu (kimlik girilmemişti); GA4 açılınca yeniden sorulur */
  ga4: boolean | null;
  /** Kararın verildiği gün (YYYYMMDD); 6 ay sonra yeniden sorulur */
  decidedAt: string;
}
export const CONSENT_COOKIE = 'dtd_consent';
export const CONSENT_MAX_AGE_DAYS = 180;

export function encodeConsent(c: Consent): string {
  return `v1.${c.analytics ? 1 : 0}.${c.ga4 === null ? 'x' : c.ga4 ? 1 : 0}.${c.decidedAt}`;
}

/** Geçersiz, eski sürüm ya da süresi dolmuş değer null döner (yeniden sorulur). */
export function decodeConsent(raw: string | null | undefined, now: Date = new Date()): Consent | null {
  const m = /^v1\.([01])\.([01x])\.(\d{8})$/.exec(raw ?? '');
  if (!m) return null;
  const d = m[3]!;
  const at = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  if (Number.isNaN(at) || now.getTime() - at > CONSENT_MAX_AGE_DAYS * 86_400_000 || at - now.getTime() > 86_400_000) return null;
  return { analytics: m[1] === '1', ga4: m[2] === 'x' ? null : m[2] === '1', decidedAt: d };
}

export function consentDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

/** GA4 ölçüm kimliği biçimi (G-XXXXXXXXXX). */
export const GA4_ID_RE = /^G-[A-Z0-9]{4,16}$/;
