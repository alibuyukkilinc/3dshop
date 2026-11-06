import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parseInput } from '../../../infra/http/admin-request.js';
import { clientInfo } from '../../../infra/http/client-info.js';
import { GUIDE_LIMITS } from '../domain/guide.js';
import { GuideService } from '../application/guide.service.js';

const AskBody = z.object({
  session_id: z.uuid().nullable().default(null),
  message: z.string().trim().min(1).max(GUIDE_LIMITS.messageMaxChars),
});

/**
 * AI rehber (F5.2, K52). Kimlik doğrulama yok; Origin kontrolü (configureHttp) ve ziyaretçi başına hız sınırı.
 * Rehber kapalıyken de 200 döner: mode "search" ile klasik arama sonucu (istemci tek biçim işler).
 */
@Controller('v1/guide')
export class GuideController {
  constructor(private readonly guide: GuideService) {}

  @Get('status')
  @Header('Cache-Control', 'public, max-age=60')
  status() {
    return { enabled: this.guide.enabled };
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  ask(@Body() body: unknown, @Req() req: Request) {
    const b = parseInput(AskBody, body);
    return this.guide.ask({ sessionId: b.session_id, message: b.message, visitorKey: clientInfo(req).ipHash ?? 'unknown' });
  }
}
