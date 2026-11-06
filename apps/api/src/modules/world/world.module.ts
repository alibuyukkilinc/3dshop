import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public/index.js';
import { MapPinPublishable } from './application/map-pin-publishable.js';
import { WorldService } from './application/world.service.js';
import { WorldAdminController } from './http/world-admin.controller.js';

@Module({
  imports: [IdentityModule],
  controllers: [WorldAdminController],
  providers: [WorldService, MapPinPublishable],
  exports: [WorldService],
})
export class WorldModule {}
