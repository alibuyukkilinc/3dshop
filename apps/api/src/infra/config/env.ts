import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.url(),
  /** Tarayıcının geldiği adresler (CSRF Origin kontrolü), virgülle ayrılmış */
  APP_ORIGINS: z
    .string()
    .default('http://localhost:5174')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  COOKIE_SECURE: bool.default(false),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** 32 baytlık base64 anahtar: veritabanındaki gizli değerleri şifreler. Asla loglanmaz. */
  SECRETS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'SECRETS_KEY 32 baytlık base64 olmalı'),
  TOTP_ISSUER: z.string().min(1).default('firmaxi'),
  /** nginx arkasında gerçek istemci IP'si için (üretimde 1) */
  TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(0),

  /** Uyarı e-postaları (F0.7). Anahtar yoksa uyarılar yalnız günlüğe yazılır. Asla loglanmaz. */
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).default('Dijital Ticaret Dünyası <info@firmaxi.com>'),
  /** Uyarıların gideceği adresler, virgülle ayrılmış */
  ALERT_EMAIL_TO: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Uyarı konusunda ortam adı (staging / production) */
  ENV_LABEL: z.string().default('yerel'),

  /** Worker kaynak siteleri zamanlı eşitler (F1.1). Yerelde canlı sitelere istek atmamak için false yapılabilir. */
  INTEGRATION_SYNC_ENABLED: bool.default(true),

  /** AI rehber (F5.2, K52). Anahtar yoksa rehber kapalıdır; site klasik aramayla çalışır. Asla loglanmaz. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Rehber modeli (K52: C1 denemesiyle seçilir) */
  AI_GUIDE_MODEL: z.string().min(1).default('claude-opus-5-5'),
  /** Maliyet sınırı: tüm ziyaretçiler için günlük en çok soru (aşılınca klasik aramaya düşer) */
  AI_GUIDE_DAILY_MAX: z.coerce.number().int().min(0).default(2000),
  /** Ziyaretçi (IP özeti) başına dakikada en çok soru */
  AI_GUIDE_PER_MINUTE: z.coerce.number().int().min(1).default(6),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  // Boş değer ("ANAHTAR=") tanımsız sayılır: isteğe bağlı ayarlar boş bırakılınca süreç çökmesin
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ortam değişkenleri geçersiz: ${fields}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('Üretimde COOKIE_SECURE=true olmalı');
  }
  cached = parsed.data;
  return cached;
}

/** Testler ortamı değiştirdikten sonra çağırır. */
export function resetEnvCache(): void {
  cached = null;
}
