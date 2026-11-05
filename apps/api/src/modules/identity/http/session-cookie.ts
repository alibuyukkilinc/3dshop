import type { Response } from 'express';
import { loadEnv } from '../../../infra/config/env.js';

export const ADMIN_COOKIE = 'dtd_admin';

/** Yönetici oturum çerezi: yalnız /api/admin yolunda, JavaScript okuyamaz, site dışından gönderilmez. */
export function setAdminCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: loadEnv().COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/admin',
    expires: expiresAt,
  });
}

export function clearAdminCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE, { path: '/api/admin', sameSite: 'strict', secure: loadEnv().COOKIE_SECURE });
}
