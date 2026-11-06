import { Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { parseInput } from '../../../infra/http/admin-request.js';
import { KEY_RE } from '../../../infra/storage/blob-store.js';
import { AdminGuard, RequireRoles } from '../../identity/public/index.js';
import { BundlesService } from '../application/bundles.service.js';
import { LiveService } from '../application/live.service.js';

const Ids = z.object({
  ids: z
    .string()
    .max(100 * 37)
    .transform((s) => [...new Set(s.split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)))].slice(0, 100)),
});

/** 3D istemci okuma yolu (K48): dünya manifesti, bölge paketi (değişmez), canlı fiyat/stok. */
@Controller('v1')
export class DeliveryController {
  constructor(
    private readonly bundles: BundlesService,
    private readonly live: LiveService,
  ) {}

  @Get('worlds/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  async world(@Param('slug') slug: string) {
    const m = await this.bundles.worldManifest(slug);
    if (!m) throw new NotFoundException({ error: 'not_found', message: 'Dünya bulunamadı.' });
    return m;
  }

  @Get('bundles/:key')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  bundle(@Param('key') key: string, @Res() res: Response) {
    if (!KEY_RE.test(key) || !key.endsWith('.json') || !this.bundles.bundleExists(key)) {
      throw new NotFoundException({ error: 'not_found', message: 'Paket yok.' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.bundles.bundleStream(key).pipe(res);
  }

  @Get('live/prices')
  @Header('Cache-Control', 'public, max-age=30')
  prices(@Query() query: unknown) {
    return this.live.prices(parseInput(Ids, query).ids);
  }
}

@Controller('admin/v1/delivery')
@UseGuards(AdminGuard)
export class DeliveryAdminController {
  constructor(private readonly bundles: BundlesService) {}

  /** Tüm bölge paketlerini şimdi derle (normalde olayla, 30 sn'de bir) */
  @Post('rebuild')
  @HttpCode(200)
  @RequireRoles('platform_admin')
  async rebuild() {
    return { built: await this.bundles.buildAll() };
  }
}
