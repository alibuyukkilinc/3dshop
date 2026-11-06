import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { GA4_ID_RE } from '@dtd/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { adminContext, parseInput } from '../../../infra/http/admin-request.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';
import { AnalyticsSettingsService } from '../application/analytics-settings.service.js';
import { ConversionsService } from '../application/conversions.service.js';
import { EventsService } from '../application/events.service.js';

const SummaryQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const Ga4Body = z.object({
  measurement_id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GA4_ID_RE, 'Ölçüm kimliği G-XXXXXXXXXX biçiminde olmalı')
    .nullable(),
});

/** Yönlendirme, dönüşüm ve olay özeti; GA4 ayarı (F5, K15, K53). */
@Controller('admin/v1/analytics')
@UseGuards(AdminGuard)
export class AnalyticsAdminController {
  constructor(
    private readonly conversions: ConversionsService,
    private readonly events: EventsService,
    private readonly settings: AnalyticsSettingsService,
  ) {}

  @Get('conversions')
  summary(@Query() query: unknown) {
    return this.conversions.summary(parseInput(SummaryQuery, query).days);
  }

  @Get('events')
  eventSummary(@Query() query: unknown) {
    return this.events.summary(parseInput(SummaryQuery, query).days);
  }

  @Get('ga4')
  ga4() {
    return this.settings.ga4();
  }

  @Put('ga4')
  @RequireRoles('platform_admin')
  setGa4(@Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.settings.setGa4(parseInput(Ga4Body, body), adminContext(s.admin.id, req));
  }
}
