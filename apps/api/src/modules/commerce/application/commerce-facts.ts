import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../infra/db/types.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';

export interface StoreFacts {
  id: string;
  companyId: string;
  status: string;
  slug: string;
  name: string;
}

/** Mağaza okuma modeli (kural motoru, vitrin): yalnız okuma. */
@Injectable()
export class CommerceFacts {
  constructor(private readonly prisma: PrismaService) {}

  async stores(ids?: string[], tx?: Tx): Promise<StoreFacts[]> {
    return (tx ?? this.prisma).store.findMany({
      where: ids ? { id: { in: ids } } : {},
      select: { id: true, companyId: true, status: true, slug: true, name: true },
    });
  }
}
