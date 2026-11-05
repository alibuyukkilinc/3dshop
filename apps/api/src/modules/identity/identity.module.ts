import { Module } from '@nestjs/common';
import { AdminAuthService } from './application/admin-auth.service.js';
import { AdminUsersService } from './application/admin-users.service.js';
import { AdminGuard } from './http/admin.guard.js';
import { AdminAuthController } from './http/admin-auth.controller.js';

@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminUsersService, AdminGuard],
  exports: [AdminAuthService, AdminUsersService, AdminGuard],
})
export class IdentityModule {}
