import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type AdminRole, AdminUsersService } from '../../src/modules/identity/public/index.js';
import { base32Decode, hotp, totpStep } from '../../src/modules/identity/domain/totp.js';
import { ORIGIN } from './test-app.js';

/** Yönetici açar, parola + 2FA ile tam oturuma geçer; çerezli istemci döner. */
export async function adminSession(app: INestApplication, email: string, roles: AdminRole[]) {
  const password = 'test-parola-uzun-123456';
  await app.get(AdminUsersService).create({ email, displayName: email.split('@')[0]!, password, roles });
  const agent = request.agent(app.getHttpServer());
  const send = (method: 'post' | 'put' | 'patch', url: string, body?: object) =>
    agent[method](`/api${url}`).set('Origin', ORIGIN).send(body ?? {});
  await send('post', '/admin/v1/auth/login', { email, password });
  const { secret } = (await send('post', '/admin/v1/auth/mfa/setup')).body as { secret: string };
  const res = await send('post', '/admin/v1/auth/mfa/verify', { code: hotp(base32Decode(secret), totpStep(Date.now())) });
  if (res.body.stage !== 'full') throw new Error(`2FA tamamlanamadı: ${JSON.stringify(res.body)}`);
  return {
    get: (url: string) => agent.get(`/api${url}`),
    post: (url: string, body?: object) => send('post', url, body),
    put: (url: string, body?: object) => send('put', url, body),
    patch: (url: string, body?: object) => send('patch', url, body),
  };
}
