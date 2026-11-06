import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditVerifier } from '../src/modules/audit/public/index.js';
import { AdminUsersService } from '../src/modules/identity/public/index.js';
import { base32Decode, hotp, totpStep } from '../src/modules/identity/domain/totp.js';
import { client, createTestApp } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

const EMAIL = 'yonetici@example.com';
const PASSWORD = 'cok-gizli-parola-123';

describe.skipIf(!hasDatabase)('yönetici girişi + zorunlu 2FA (F0.3)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let secret = '';
  let recovery: string[] = [];
  /** Kurulumda kullanılan TOTP adımı: sonraki test aynı kodu yeniden dener (adım sınırına denk gelse de) */
  let usedStep = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createTestApp(db);
    await app.get(AdminUsersService).create({
      email: EMAIL,
      displayName: 'Yönetici',
      password: PASSWORD,
      roles: ['platform_admin', 'approver'],
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('sağlık uçları', async () => {
    const c = client(app);
    expect((await c.get('/healthz')).body).toEqual({ status: 'ok' });
    expect((await c.get('/readyz')).body).toEqual({ status: 'ready' });
  });

  it('Origin olmadan durum değiştiren istek reddedilir (CSRF)', async () => {
    const res = await client(app).raw.post('/api/admin/v1/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('yanlış parola ve olmayan kullanıcı aynı yanıtı alır', async () => {
    const c = client(app);
    const a = await c.post('/admin/v1/auth/login', { email: EMAIL, password: 'yanlis-parola-xx' });
    const b = await c.post('/admin/v1/auth/login', { email: 'yok@example.com', password: 'yanlis-parola-xx' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('ilk giriş: parola -> 2FA kurulumu -> tam oturum; 2FA olmadan korumalı uç kapalı', async () => {
    const c = client(app);
    const login = await c.post('/admin/v1/auth/login', { email: EMAIL.toUpperCase(), password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ stage: 'mfa_setup' });
    const cookie = login.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/admin');

    const blocked = await c.get('/admin/v1/auth/me');
    expect(blocked.status).toBe(401);
    expect(blocked.body.error).toBe('mfa_required');

    const setup = await c.post('/admin/v1/auth/mfa/setup');
    expect(setup.status).toBe(200);
    secret = setup.body.secret;
    expect(setup.body.otpauth_url).toContain('otpauth://totp/');

    const wrong = await c.post('/admin/v1/auth/mfa/verify', { code: '000000' });
    expect(wrong.status).toBe(401);

    usedStep = totpStep(Date.now());
    const code = hotp(base32Decode(secret), usedStep);
    const verified = await c.post('/admin/v1/auth/mfa/verify', { code });
    expect(verified.status).toBe(200);
    expect(verified.body.stage).toBe('full');
    recovery = verified.body.recovery_codes;
    expect(recovery).toHaveLength(10);

    const me = await c.get('/admin/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: EMAIL, roles: expect.arrayContaining(['platform_admin', 'approver']) });

    expect((await c.post('/admin/v1/auth/logout')).status).toBe(204);
    expect((await c.get('/admin/v1/auth/me')).status).toBe(401);
  });

  it('sonraki giriş: aynı TOTP kodu ikinci kez kullanılamaz; sonraki adımın kodu geçer', async () => {
    const c = client(app);
    expect((await c.post('/admin/v1/auth/login', { email: EMAIL, password: PASSWORD })).body).toEqual({
      stage: 'mfa_verify',
    });
    const step = usedStep;
    const reused = await c.post('/admin/v1/auth/mfa/verify', { code: hotp(base32Decode(secret), step) });
    expect(reused.status).toBe(401);
    const next = await c.post('/admin/v1/auth/mfa/verify', { code: hotp(base32Decode(secret), step + 1) });
    expect(next.status).toBe(200);
    expect(next.body).toEqual({ stage: 'full' });
  });

  it('kurtarma kodu bir kez kullanılır', async () => {
    const [code] = recovery as [string];
    const c1 = client(app);
    await c1.post('/admin/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect((await c1.post('/admin/v1/auth/mfa/verify', { code: code.toLowerCase() })).status).toBe(200);

    const c2 = client(app);
    await c2.post('/admin/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect((await c2.post('/admin/v1/auth/mfa/verify', { code })).status).toBe(401);
  });

  it('denetim zinciri sağlam; uygulama rolü denetim kaydını değiştiremez (K47)', async () => {
    const check = await app.get(AuditVerifier).verify();
    expect(check.ok).toBe(true);
    expect(check.checked).toBeGreaterThan(5);

    const appDb = new pg.Client({ connectionString: db.appUrl });
    await appDb.connect();
    try {
      await expect(appDb.query(`UPDATE audit.audit_log SET reason = 'x'`)).rejects.toThrow();
      await expect(appDb.query(`DELETE FROM audit.audit_log`)).rejects.toThrow();
    } finally {
      await appDb.end();
    }
    const owner = new pg.Client({ connectionString: db.ownerUrl });
    await owner.connect();
    try {
      // Sahip rol bile satırı değiştiremez (tetikleyici)
      await expect(owner.query(`UPDATE audit.audit_log SET reason = 'x'`)).rejects.toThrow(/değiştirilemez/);
      const actions = await owner.query(`SELECT action FROM audit.audit_log ORDER BY seq`);
      expect(actions.rows.map((r) => r.action)).toEqual(
        expect.arrayContaining([
          'identity.admin.created',
          'identity.admin.login_failed',
          'identity.admin.mfa_enabled',
          'identity.admin.login',
          'identity.admin.login_recovery_code',
          'identity.admin.logout',
        ]),
      );
    } finally {
      await owner.end();
    }
  });

  it('5 hatalı parola hesabı kilitler; doğru parola da kilitte reddedilir', async () => {
    await app.get(AdminUsersService).create({
      email: 'kilit@example.com',
      displayName: 'Kilit',
      password: PASSWORD,
      roles: ['editor'],
    });
    const c = client(app);
    for (let i = 0; i < 5; i++) {
      expect((await c.post('/admin/v1/auth/login', { email: 'kilit@example.com', password: 'yanlis-1234567' })).status).toBe(401);
    }
    const locked = await c.post('/admin/v1/auth/login', { email: 'kilit@example.com', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('account_locked');
  });
});
