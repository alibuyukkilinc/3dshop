import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminGuard, RequireRoles } from '../../identity/public/index.js';
import { PlacementService } from '../application/placement.service.js';

/** Yerleşim (F5.1): yuvalar, kurallar, çalıştırmalar. Kural ve pin yazımı changeset ile (K44). */
@Controller('admin/v1/placement')
@UseGuards(AdminGuard)
export class PlacementAdminController {
  constructor(private readonly placement: PlacementService) {}

  @Get('slots')
  async slots() {
    return { items: await this.placement.slots() };
  }

  @Get('rules')
  async rules() {
    return { items: await this.placement.rules() };
  }

  @Get('runs')
  async runs() {
    return { items: await this.placement.runs() };
  }

  /** Şimdi çalıştır (normalde olayla ve saatlik) */
  @Post('run')
  @HttpCode(200)
  @RequireRoles('platform_admin', 'editor')
  run() {
    return this.placement.run('manual');
  }
}
