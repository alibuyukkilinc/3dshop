import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public/index.js';
import { ChangesetsService } from './application/changesets.service.js';
import { ChangesetsController } from './http/changesets.controller.js';

@Module({
  imports: [IdentityModule],
  controllers: [ChangesetsController],
  providers: [ChangesetsService],
  exports: [ChangesetsService],
})
export class PublishingModule {}
