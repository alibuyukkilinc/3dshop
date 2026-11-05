import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/public/index.js';
import { CommerceModule } from '../commerce/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { VisibilityEventHandler } from './application/visibility-events.js';
import { VisibilityService } from './application/visibility.service.js';
import { RulesAdminController } from './http/rules-admin.controller.js';

@Module({
  imports: [CatalogModule, CommerceModule, IdentityModule],
  controllers: [RulesAdminController],
  providers: [VisibilityService, VisibilityEventHandler],
  exports: [VisibilityService, VisibilityEventHandler],
})
export class RulesModule {}
