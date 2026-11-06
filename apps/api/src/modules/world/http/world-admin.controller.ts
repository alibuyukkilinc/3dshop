import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../identity/public/index.js';
import { WorldService } from '../application/world.service.js';

/** Mekân (F3.1): dünyalar, bölgeler, tramvay, şube pinleri. Pin değişikliği değişiklik setiyle (map_pin). */
@Controller('admin/v1/world')
@UseGuards(AdminGuard)
export class WorldAdminController {
  constructor(private readonly world: WorldService) {}

  @Get('worlds')
  async worlds() {
    return { items: await this.world.worlds() };
  }

  @Get('branches')
  async branches() {
    return { items: await this.world.branches() };
  }

  @Get('admin-areas')
  async areas() {
    return { items: await this.world.adminAreas() };
  }
}
