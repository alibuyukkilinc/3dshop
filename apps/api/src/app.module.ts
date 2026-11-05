import { Module } from '@nestjs/common';
import { DbModule } from './infra/db/db.module.js';
import { HealthController } from './infra/http/health.controller.js';
import { AuditModule } from './modules/audit/public/index.js';
import { IdentityModule } from './modules/identity/public/index.js';
import { PlatformModule } from './modules/platform/public/index.js';

@Module({
  imports: [DbModule, PlatformModule, AuditModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
