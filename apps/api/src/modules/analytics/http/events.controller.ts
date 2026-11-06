import { Controller, Get, Header, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientInfo } from '../../../infra/http/client-info.js';
import { RateLimiter } from '../../../infra/http/rate-limit.js';
import { AnalyticsSettingsService } from '../application/analytics-settings.service.js';
import { EventsService } from '../application/events.service.js';

// İstemci 20'lik paketler gönderir; normal gezinme dakikada birkaç istek. IP özeti başına sınır (IP saklanmaz).
const limiter = new RateLimiter(60, 60_000);

/**
 * Platform olay toplama (K15, K37) ve halka açık site ayarı. Tarayıcı yalnız analitik rızası verildiyse olay
 * gönderir (KVKK, varsayılan red). Yanıt gövdesiz 204; geçersiz paket 400 ama istemci hatayı yutar.
 */
@Controller('v1')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly settings: AnalyticsSettingsService,
  ) {}

  @Post('events')
  @HttpCode(204)
  async collect(@Req() req: Request): Promise<void> {
    if (!limiter.take(clientInfo(req).ipHash ?? 'unknown')) {
      throw new HttpException({ error: 'rate_limited', message: 'Çok fazla istek.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const batch = this.events.parse(req.body);
    if ('error' in batch) throw new HttpException({ error: 'invalid_request', message: 'Olay paketi geçersiz.' }, HttpStatus.BAD_REQUEST);
    await this.events.ingest(batch);
  }

  /** Web kabuğunun ihtiyaç duyduğu genel ayarlar (sır içermez). */
  @Get('site-config')
  @Header('Cache-Control', 'public, max-age=300')
  async siteConfig() {
    const ga4 = await this.settings.ga4();
    return { ga4_measurement_id: ga4.measurement_id };
  }
}
