import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from './env.js';

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe('ortam ayarları', () => {
  it('boş bırakılan isteğe bağlı ayar süreci çökertmez (staging 2026-11-05 olayı)', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/x';
    process.env.SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.RESEND_API_KEY = '';
    process.env.ALERT_EMAIL_TO = '';
    resetEnvCache();
    const env = loadEnv();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.ALERT_EMAIL_TO).toEqual([]);
  });

  it('zorunlu ayar eksikse anlaşılır hata verir', () => {
    delete process.env.DATABASE_URL;
    process.env.SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');
    resetEnvCache();
    expect(() => loadEnv()).toThrow(/DATABASE_URL/);
  });
});
