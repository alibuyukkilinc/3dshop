import { Module } from '@nestjs/common';
import { DbModule } from './infra/db/db.module.js';
import { HealthController } from './infra/http/health.controller.js';
import { AnalyticsModule } from './modules/analytics/public/index.js';
import { AuditModule } from './modules/audit/public/index.js';
import { CatalogModule } from './modules/catalog/public/index.js';
import { CommerceModule } from './modules/commerce/public/index.js';
import { DiscoveryModule } from './modules/discovery/public/index.js';
import { IdentityModule } from './modules/identity/public/index.js';
import { IntegrationModule } from './modules/integration/public/index.js';
import { OpsModule } from './modules/ops/public/index.js';
import { PlatformModule } from './modules/platform/public/index.js';
import { PublishingModule } from './modules/publishing/public/index.js';
import { RulesModule } from './modules/rules/public/index.js';
import { WorldModule } from './modules/world/public/index.js';
import { SceneModule } from './modules/scene/public/index.js';

@Module({
  imports: [DbModule, PlatformModule, AuditModule, IdentityModule, OpsModule, CommerceModule, CatalogModule, IntegrationModule, RulesModule, PublishingModule, DiscoveryModule, AnalyticsModule, WorldModule, SceneModule],
  controllers: [HealthController],
})
export class AppModule {}
