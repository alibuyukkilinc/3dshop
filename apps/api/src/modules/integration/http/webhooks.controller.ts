import { Controller, HttpCode, HttpException, HttpStatus, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimiter } from '../../../infra/http/rate-limit.js';
import { WebhooksService } from '../application/webhooks.service.js';

// Site başına dakikada 600 istek: toplu fiyat güncellemesinde eticaret ürün başına olay gönderebilir
const limiter = new RateLimiter(600, 60_000);

/**
 * Kaynak e-ticaret webhook alıcısı (B2). Tarayıcıdan gelmez: CSRF Origin kontrolünden muaf (configureHttp),
 * yönetici oturumu yok; yalnız HMAC imzasıyla korunur. İmza ham gövde üzerinden doğrulanır (rawBody: true).
 */
@Controller('webhooks/sources')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':site')
  @HttpCode(202)
  async receive(@Param('site') site: string, @Req() req: RawBodyRequest<Request>) {
    if (!limiter.take(site)) {
      throw new HttpException({ error: 'rate_limited', message: 'Çok fazla istek.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.webhooks.receive(
      site,
      {
        eventId: req.get('x-dtd-event-id') ?? undefined,
        timestamp: req.get('x-dtd-timestamp') ?? undefined,
        signature: req.get('x-dtd-signature') ?? undefined,
      },
      req.rawBody,
    );
  }
}
