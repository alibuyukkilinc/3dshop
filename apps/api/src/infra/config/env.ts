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
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
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
