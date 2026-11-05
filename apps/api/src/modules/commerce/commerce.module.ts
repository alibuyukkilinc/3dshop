import { Module } from '@nestjs/common';
import { StoresService } from './application/stores.service.js';

@Module({
  providers: [StoresService],
  exports: [StoresService],
})
export class CommerceModule {}
