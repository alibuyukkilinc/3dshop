import { Module } from '@nestjs/common';
import { RedirectsService } from './application/redirects.service.js';

/** Analitik (K15, K53). Hiçbir domain modülüne bağımlı değil; diğerleri RedirectService'i çağırır. */
@Module({
  providers: [RedirectsService],
  exports: [RedirectsService],
})
export class AnalyticsModule {}
