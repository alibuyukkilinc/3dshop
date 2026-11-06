import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { RulesModule } from '../rules/public/index.js';
import { SceneModule } from '../scene/public/index.js';
import { PlacementEventHandler } from './application/placement-events.js';
import { PlacementPinPublishable, PlacementRulePublishable } from './application/placement-publishable.js';
import { PlacementService } from './application/placement.service.js';
import { PlacementAdminController } from './http/placement-admin.controller.js';

@Module({
  imports: [CatalogModule, IdentityModule, RulesModule, SceneModule],
  controllers: [PlacementAdminController],
  providers: [PlacementService, PlacementEventHandler, PlacementRulePublishable, PlacementPinPublishable],
  exports: [PlacementService, PlacementEventHandler],
})
export class PlacementModule {}
