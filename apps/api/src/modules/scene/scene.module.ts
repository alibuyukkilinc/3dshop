import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { ScenePublishable } from './application/scene-publishable.js';
import { ScenesService } from './application/scenes.service.js';
import { PublicScenesController, ScenesAdminController } from './http/scenes.controller.js';

@Module({
  imports: [IdentityModule, AssetsModule],
  controllers: [ScenesAdminController, PublicScenesController],
  providers: [ScenesService, ScenePublishable],
  exports: [ScenesService],
})
export class SceneModule {}
