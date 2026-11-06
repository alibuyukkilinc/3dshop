import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';

/** Merkezi platform ayarları (K07). Sır değerler burada tutulmaz. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row && row.value !== null ? (row.value as T) : fallback;
  }

  /** Önekle başlayan ayarlar (ör. delivery.bundle.*) */
  async list<T>(prefix: string): Promise<{ key: string; value: T }[]> {
    const rows = await this.prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
    return rows.map((r) => ({ key: r.key, value: r.value as T }));
  }

  async set(key: string, value: unknown, by: string | null = null, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    const v = (value ?? null) as Prisma.InputJsonValue;
    await db.setting.upsert({
      where: { key },
      create: { key, value: v, updatedBy: by },
      update: { value: v, updatedBy: by, version: { increment: 1 } },
    });
  }
}
