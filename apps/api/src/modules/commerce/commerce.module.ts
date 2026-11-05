import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { CommerceAdminService } from './application/commerce-admin.service.js';
import { CommerceFacts } from './application/commerce-facts.js';
import { StoresService } from './application/stores.service.js';
import { CommerceAdminController } from './http/commerce-admin.controller.js';

@Module({
  imports: [AuditModule, IdentityModule],
  controllers: [CommerceAdminController],
  providers: [StoresService, CommerceAdminService, CommerceFacts],
  exports: [StoresService, CommerceAdminService, CommerceFacts],
})
export class CommerceModule {}
