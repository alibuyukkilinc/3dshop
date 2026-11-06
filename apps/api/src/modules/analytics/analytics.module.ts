import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public/index.js';
import { ConversionEventHandler } from './application/conversion-events.js';
import { ConversionsService } from './application/conversions.service.js';
import { RedirectsService } from './application/redirects.service.js';
import { AnalyticsAdminController } from './http/analytics-admin.controller.js';

/** Analitik (K15, K53). Hiçbir domain modülüne bağımlı değil; diğerleri RedirectsService'i çağırır. */
@Module({
  imports: [IdentityModule],
  controllers: [AnalyticsAdminController],
  providers: [RedirectsService, ConversionsService, ConversionEventHandler],
  exports: [RedirectsService, ConversionsService, ConversionEventHandler],
})
export class AnalyticsModule {}
