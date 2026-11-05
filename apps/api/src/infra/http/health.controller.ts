import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service.js';

/** Sağlık uçları (K59): /api/healthz süreç ayakta mı, /api/readyz veritabanına ulaşılıyor mu. */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  health() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new HttpException({ status: 'not_ready' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
