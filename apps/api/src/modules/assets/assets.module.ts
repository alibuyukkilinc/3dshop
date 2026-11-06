import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public/index.js';
import { AssetsService } from './application/assets.service.js';
import { AssetFilesController, AssetsAdminController } from './http/assets.controller.js';

@Module({
  imports: [IdentityModule],
  controllers: [AssetsAdminController, AssetFilesController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
