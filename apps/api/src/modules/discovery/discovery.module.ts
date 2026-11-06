import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/public/index.js';
import { CatalogModule } from '../catalog/public/index.js';
import { CommerceModule } from '../commerce/public/index.js';
import { RulesModule } from '../rules/public/index.js';
import { WorldModule } from '../world/public/index.js';
import { GUIDE_LLM, guideLlmFromEnv } from './application/guide-llm.js';
import { GuideTools } from './application/guide-tools.js';
import { GuideService } from './application/guide.service.js';
import { StorefrontService } from './application/storefront.service.js';
import { GuideController } from './http/guide.controller.js';
import { PublicCatalogController } from './http/public-catalog.controller.js';

@Module({
  imports: [CatalogModule, CommerceModule, RulesModule, AnalyticsModule, WorldModule],
  controllers: [PublicCatalogController, GuideController],
  providers: [StorefrontService, GuideTools, GuideService, { provide: GUIDE_LLM, useFactory: guideLlmFromEnv }],
  exports: [StorefrontService, GuideService],
})
export class DiscoveryModule {}
