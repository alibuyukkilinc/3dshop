import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/public/index.js';
import { CatalogModule } from '../catalog/public/index.js';
import { CommerceModule } from '../commerce/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { PlacementModule } from '../placement/public/index.js';
import { RulesModule } from '../rules/public/index.js';
import { SceneModule } from '../scene/public/index.js';
import { WorldModule } from '../world/public/index.js';
import { BundlesService } from './application/bundles.service.js';
import { DeliveryEventHandler } from './application/delivery-events.js';
import { InteriorService } from './application/interior.service.js';
import { LiveService } from './application/live.service.js';
import { DeliveryAdminController, DeliveryController } from './http/delivery.controller.js';

@Module({
  imports: [AssetsModule, CatalogModule, CommerceModule, IdentityModule, PlacementModule, RulesModule, SceneModule, WorldModule],
  controllers: [DeliveryController, DeliveryAdminController],
  providers: [BundlesService, LiveService, DeliveryEventHandler, InteriorService],
  exports: [BundlesService, DeliveryEventHandler],
})
export class DeliveryModule {}
