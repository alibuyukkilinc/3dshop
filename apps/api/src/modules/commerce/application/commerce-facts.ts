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

export interface PublicStore {
  id: string;
  slug: string;
  name: string;
  company: { display_name: string; website: string | null };
}

/** Mağaza ve marka okuma modeli (kural motoru, vitrin): yalnız okuma. */
@Injectable()
export class CommerceFacts {
  constructor(private readonly prisma: PrismaService) {}

  async stores(ids?: string[], tx?: Tx): Promise<StoreFacts[]> {
    return (tx ?? this.prisma).store.findMany({
      where: ids ? { id: { in: ids } } : {},
      select: { id: true, companyId: true, status: true, slug: true, name: true },
    });
  }

  async publicStores(ids: string[]): Promise<PublicStore[]> {
    const rows = await this.prisma.store.findMany({
      where: { id: { in: ids } },
      orderBy: { name: 'asc' },
      include: { company: { select: { displayName: true, website: true } } },
    });
    return rows.map((s) => ({ id: s.id, slug: s.slug, name: s.name, company: { display_name: s.company.displayName, website: s.company.website } }));
  }

  async storeBySlug(slug: string): Promise<PublicStore | null> {
    const s = await this.prisma.store.findUnique({ where: { slug }, include: { company: { select: { displayName: true, website: true } } } });
    return s ? { id: s.id, slug: s.slug, name: s.name, company: { display_name: s.company.displayName, website: s.company.website } } : null;
  }

  async brands(ids: string[]): Promise<{ id: string; slug: string; name: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.brand.findMany({ where: { id: { in: ids }, status: 'active' }, select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } });
  }

  async brandBySlug(slug: string): Promise<{ id: string; slug: string; name: string } | null> {
    const b = await this.prisma.brand.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, status: true } });
    return b && b.status === 'active' ? { id: b.id, slug: b.slug, name: b.name } : null;
  }
}
