import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseInput } from '../../../infra/http/admin-request.js';
import { AdminGuard } from '../../identity/public/index.js';
import { ConversionsService } from '../application/conversions.service.js';

const SummaryQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** Yönlendirme ve dönüşüm özeti (F5, K53). */
@Controller('admin/v1/analytics')
@UseGuards(AdminGuard)
export class AnalyticsAdminController {
  constructor(private readonly conversions: ConversionsService) {}

  @Get('conversions')
  summary(@Query() query: unknown) {
    return this.conversions.summary(parseInput(SummaryQuery, query).days);
  }
}
