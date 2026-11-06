import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public/index.js';
import { AnalyticsSettingsService } from './application/analytics-settings.service.js';
import { ConversionEventHandler } from './application/conversion-events.js';
import { ConversionsService } from './application/conversions.service.js';
import { EventsService } from './application/events.service.js';
import { RedirectsService } from './application/redirects.service.js';
import { AnalyticsAdminController } from './http/analytics-admin.controller.js';
import { EventsController } from './http/events.controller.js';

/** Analitik (K15, K37, K53). Hiçbir domain modülüne bağımlı değil; diğerleri RedirectsService'i çağırır. */
@Module({
  imports: [IdentityModule],
  controllers: [AnalyticsAdminController, EventsController],
  providers: [RedirectsService, ConversionsService, ConversionEventHandler, EventsService, AnalyticsSettingsService],
  exports: [RedirectsService, ConversionsService, ConversionEventHandler, EventsService],
})
export class AnalyticsModule {}
