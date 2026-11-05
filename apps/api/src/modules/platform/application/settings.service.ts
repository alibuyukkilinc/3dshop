import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/db/prisma.service.js';

/** Merkezi platform ayarları (K07). Sır değerler burada tutulmaz. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }
}
