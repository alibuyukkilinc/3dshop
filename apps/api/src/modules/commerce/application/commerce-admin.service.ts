import { Injectable } from '@nestjs/common';
import { SLUG_RE, normalizeKey, slugify, uuidv7 } from '@dtd/contracts';
import { type AdminContext, conflict, notFound } from '../../../infra/http/admin-request.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { AuditWriter } from '../../audit/public/index.js';
import { OutboxWriter } from '../../platform/public/index.js';

export interface CompanyPatch {
  version: number;
  legal_name?: string;
  display_name?: string;
  tax_number?: string | null;
  website?: string | null;
}
export interface StorePatch {
  version: number;
  name?: string;
  slug?: string;
}
export interface BrandInput {
  name: string;
  slug?: string;
}
export interface BrandPatch {
  version: number;
  name?: string;
  status?: 'active' | 'archived';
}

/**
 * Ticari yapının yönetim yüzü (F1.3, K39). Her yazım iyimser kilitli (version, K33), denetim kaydı ve olay aynı
 * transaction'da (K34, K47).
 */
@Injectable()
export class CommerceAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async companies() {
    const rows = await this.prisma.company.findMany({
      orderBy: { displayName: 'asc' },
      include: { stores: { orderBy: { name: 'asc' }, include: { sources: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      legal_name: c.legalName,
      display_name: c.displayName,
      tax_number: c.taxNumber,
      kind: c.kind,
      status: c.status,
      website: c.website,
      version: c.version,
      stores: c.stores.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        store_type: s.storeType,
        status: s.status,
        logo_url: s.logoUrl,
        icon_url: s.iconUrl,
        version: s.version,
        source_site_ids: s.sources.map((x) => x.sourceSiteId),
      })),
    }));
  }

  async updateCompany(id: string, patch: CompanyPatch, ctx: AdminContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.company.findUnique({ where: { id } });
      if (!before) throw notFound('Firma bulunamadı.');
      const data = {
        ...(patch.legal_name !== undefined && { legalName: patch.legal_name.trim() }),
        ...(patch.display_name !== undefined && { displayName: patch.display_name.trim() }),
        ...(patch.tax_number !== undefined && { taxNumber: patch.tax_number?.trim() || null }),
        ...(patch.website !== undefined && { website: patch.website?.trim() || null }),
      };
      if (data.taxNumber) {
        const clash = await tx.company.findFirst({ where: { taxNumber: data.taxNumber, id: { not: id } } });
        if (clash) throw conflict('Bu vergi numarası başka bir firmada kayıtlı.');
      }
      const r = await tx.company.updateMany({ where: { id, version: patch.version }, data: { ...data, version: { increment: 1 } } });
      if (r.count === 0) throw conflict('Firma siz düzenlerken değişti. Sayfayı yenileyin.');
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'commerce.company.updated',
        entity: { type: 'company', id },
        diff: diff(before as unknown as Record<string, unknown>, data),
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
      await this.outbox.append(tx, {
        type: 'commerce.company.updated',
        sourceModule: 'commerce',
        aggregate: { type: 'company', id },
        actor: ctx.actor,
        data: { company_id: id, fields: Object.keys(data) },
      });
      return { id, version: patch.version + 1 };
    });
  }

  async updateStore(id: string, patch: StorePatch, ctx: AdminContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.store.findUnique({ where: { id } });
      if (!before) throw notFound('Mağaza bulunamadı.');
      const data: { name?: string; slug?: string } = {};
      if (patch.name !== undefined) data.name = patch.name.trim();
      if (patch.slug !== undefined && patch.slug !== before.slug) {
        // Kalıcı adres (SEO): yalnız taslak mağazada değişir; yayındaki mağazada yönlendirme kuralı gerekir (F2)
        if (before.status !== 'draft') throw conflict('Yayındaki mağazanın adresi değiştirilemez.');
        if (!SLUG_RE.test(patch.slug)) throw conflict('Adres yalnız küçük harf, rakam ve tire içerebilir.');
        if (await tx.store.findUnique({ where: { slug: patch.slug } })) throw conflict('Bu adres kullanılıyor.');
        data.slug = patch.slug;
      }
      const r = await tx.store.updateMany({ where: { id, version: patch.version }, data: { ...data, version: { increment: 1 } } });
      if (r.count === 0) throw conflict('Mağaza siz düzenlerken değişti. Sayfayı yenileyin.');
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'commerce.store.updated',
        entity: { type: 'store', id },
        diff: diff(before as unknown as Record<string, unknown>, data),
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
      await this.outbox.append(tx, {
        type: 'commerce.store.updated',
        sourceModule: 'commerce',
        aggregate: { type: 'store', id },
        actor: ctx.actor,
        data: { store_id: id, fields: Object.keys(data) },
      });
      return { id, version: patch.version + 1 };
    });
  }

  async brands() {
    const rows = await this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
    return rows.map((b) => ({ id: b.id, name: b.name, slug: b.slug, status: b.status, version: b.version }));
  }

  async createBrand(input: BrandInput, ctx: AdminContext) {
    const name = input.name.trim().replace(/\s+/g, ' ');
    const slug = input.slug ?? slugify(name);
    if (!SLUG_RE.test(slug)) throw conflict('Adres yalnız küçük harf, rakam ve tire içerebilir.');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.brand.findMany({ select: { name: true, slug: true } });
      if (existing.some((b) => b.slug === slug || normalizeKey(b.name) === normalizeKey(name))) {
        throw conflict('Bu marka zaten var.');
      }
      const id = uuidv7();
      await tx.brand.create({ data: { id, name, slug } });
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'commerce.brand.created',
        entity: { type: 'brand', id },
        diff: { name, slug },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
      await this.outbox.append(tx, {
        type: 'commerce.brand.created',
        sourceModule: 'commerce',
        aggregate: { type: 'brand', id },
        actor: ctx.actor,
        data: { brand_id: id, name, slug },
      });
      return { id, name, slug, status: 'active', version: 1 };
    });
  }

  async updateBrand(id: string, patch: BrandPatch, ctx: AdminContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.brand.findUnique({ where: { id } });
      if (!before) throw notFound('Marka bulunamadı.');
      const data = {
        ...(patch.name !== undefined && { name: patch.name.trim().replace(/\s+/g, ' ') }),
        ...(patch.status !== undefined && { status: patch.status }),
      };
      const r = await tx.brand.updateMany({ where: { id, version: patch.version }, data: { ...data, version: { increment: 1 } } });
      if (r.count === 0) throw conflict('Marka siz düzenlerken değişti. Sayfayı yenileyin.');
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'commerce.brand.updated',
        entity: { type: 'brand', id },
        diff: diff(before as unknown as Record<string, unknown>, data),
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
      await this.outbox.append(tx, {
        type: 'commerce.brand.updated',
        sourceModule: 'commerce',
        aggregate: { type: 'brand', id },
        actor: ctx.actor,
        data: { brand_id: id, fields: Object.keys(data) },
      });
      return { id, version: patch.version + 1 };
    });
  }

  /** Diğer modüller için: marka var mı (eşleme doğrulaması). */
  async brandExists(id: string): Promise<boolean> {
    return (await this.prisma.brand.count({ where: { id, status: 'active' } })) > 0;
  }
}

/** Denetim kaydı için yalnız değişen alanların önceki/sonraki değeri. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) if (before[k] !== v) out[k] = { from: before[k] ?? null, to: v ?? null };
  return out;
}
