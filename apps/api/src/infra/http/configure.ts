import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Ortak HTTP ayarları: /api öneki, çerezler, güvenlik başlıkları, CSRF için Origin kontrolü.
 * Webhook uçları (/api/webhooks/...) tarayıcıdan gelmez; kendi HMAC imzasıyla korunur (F1).
 */
export function configureHttp(app: NestExpressApplication, env: Env): void {
  app.setGlobalPrefix('api');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(cookieParser());

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/admin/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || req.path.startsWith('/api/webhooks/')) return next();
    const origin = req.get('origin');
    if (!origin || !env.APP_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'origin_not_allowed', message: 'İstek izinli bir adresten gelmedi.' });
      return;
    }
    next();
  });
}
