import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { loadEnv } from '../config/env.js';

/**
 * Çalışma anı bağlantısı dtd_app rolüyle kurulur. Oturum saat dilimi UTC: pg adaptörü timestamptz
 * değerlerini UTC varsayar.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: loadEnv().DATABASE_URL, options: '-c TimeZone=UTC' }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
