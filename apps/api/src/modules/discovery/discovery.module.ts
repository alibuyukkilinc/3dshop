import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/public/index.js';
import { CatalogModule } from '../catalog/public/index.js';
import { CommerceModule } from '../commerce/public/index.js';
import { RulesModule } from '../rules/public/index.js';
import { StorefrontService } from './application/storefront.service.js';
import { PublicCatalogController } from './http/public-catalog.controller.js';

@Module({
  imports: [CatalogModule, CommerceModule, RulesModule, AnalyticsModule],
  controllers: [PublicCatalogController],
  providers: [StorefrontService],
  exports: [StorefrontService],
})
export class DiscoveryModule {}
