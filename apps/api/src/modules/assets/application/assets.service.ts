import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { type AdminContext, conflict, notFound } from '../../../infra/http/admin-request.js';
import { BlobStore, MIME } from '../../../infra/storage/blob-store.js';
import { AuditWriter } from '../../audit/public/index.js';
import { OutboxWriter } from '../../platform/public/index.js';
import { optimizeLods, validateGlb } from '../domain/glb.js';

export const ASSET_KINDS = ['building', 'prop', 'furniture', 'product_model', 'texture', 'environment'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const LICENSE_TYPES = ['owned', 'cc0', 'cc_by', 'commercial', 'custom'] as const;

export interface LicenseInput {
  license_type: (typeof LICENSE_TYPES)[number];
  source_url?: string | null;
  attribution?: string | null;
  /** true: belge/kaynak görüldü, lisans doğrulandı */
  verify: boolean;
}

const MAX_ATTEMPTS = 3;

/**
 * 3D varlık kütüphanesi (K27, K38, K46). Yükleme kaynağı saklayıp işleme işi açar; worker doğrular ve LOD'ları
 * üretir. Bozuk/zararlı dosya reddedilir (rejected) ve hiç işlenmez. Lisans normal kuraldır: doğrulanmamış
 * lisanslı varlık, yöneticinin gerekçeli istisnası yoksa yayındaki sahneye giremez.
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger('assets');
  private readonly store = BlobStore.fromEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  /** Yeni varlık ya da var olan varlığa yeni sürüm (asset_id verilirse). */
  async upload(
    data: Buffer,
    meta: { name: string; kind: AssetKind; asset_id?: string; tags?: string[]; license?: LicenseInput },
    ctx: AdminContext,
  ) {
    if (data.length < 20) throw new HttpException({ error: 'empty', message: 'Dosya boş.' }, HttpStatus.BAD_REQUEST);
    const file = await this.store.put(data, 'glb');
    return this.prisma.$transaction(async (tx) => {
      let assetId = meta.asset_id;
      let number = 1;
      if (assetId) {
        const a = await tx.asset.findUnique({ where: { id: assetId } });
        if (!a) throw notFound('Varlık bulunamadı.');
        number = ((await tx.assetVersion.aggregate({ where: { assetId }, _max: { number: true } }))._max.number ?? 0) + 1;
      } else {
        assetId = uuidv7();
        await tx.asset.create({ data: { id: assetId, kind: meta.kind, name: meta.name.trim(), tags: meta.tags ?? [] } });
      }
      const versionId = uuidv7();
      await tx.assetVersion.create({ data: { id: versionId, assetId, number, createdBy: ctx.actor.id } });
      await tx.assetFile.create({
        data: { id: uuidv7(), assetVersionId: versionId, role: 'source', storageKey: file.key, bytes: file.bytes, mime: MIME.glb!, sha256: file.sha256 },
      });
      await tx.assetProcessingJob.create({ data: { id: uuidv7(), assetVersionId: versionId } });
      await tx.asset.update({ where: { id: assetId }, data: { status: 'processing' } });
      if (meta.license) await this.writeLicense(tx, assetId, meta.license, ctx);
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'assets.version.uploaded',
        entity: { type: 'asset', id: assetId },
        diff: { number, bytes: file.bytes, sha256: file.sha256, name: meta.name },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
      return { asset_id: assetId, version_id: versionId, number };
    });
  }

  /** Bekleyen işleri işler (worker). Döner: işlenen iş sayısı. */
  async processPending(limit = 5): Promise<number> {
    const jobs = await this.prisma.assetProcessingJob.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: limit });
    for (const job of jobs) await this.processJob(job.id);
    return jobs.length;
  }

  async processJob(jobId: string): Promise<void> {
    const claimed = await this.prisma.assetProcessingJob.updateMany({
      where: { id: jobId, status: 'pending' },
      data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return;
    const job = await this.prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: jobId }, include: { version: { include: { files: true, asset: true } } } });
    const v = job.version;
    try {
      const source = v.files.find((f) => f.role === 'source')!;
      const buf = await streamToBuffer(this.store.stream(source.storageKey));
      const { report } = await validateGlb(buf);
      if (!report.ok) {
        await this.prisma.$transaction(async (tx) => {
          await tx.assetVersion.update({ where: { id: v.id }, data: { status: 'rejected', validationReport: report as unknown as Prisma.InputJsonValue } });
          await tx.assetProcessingJob.update({ where: { id: jobId }, data: { status: 'succeeded', finishedAt: new Date() } });
          // Varlığın yayındaki sürümü varsa varlık hazır kalır; ilk sürümse reddedilir
          if (!v.asset.currentVersionId) await tx.asset.update({ where: { id: v.assetId }, data: { status: 'rejected' } });
        });
        return;
      }
      const lods = await optimizeLods(buf);
      const stored = await Promise.all(lods.map(async (l) => ({ ...l, file: await this.store.put(l.data, 'glb') })));
      const license = await this.licenseStatus(v.assetId);
      await this.prisma.$transaction(async (tx) => {
        for (const l of stored) {
          await tx.assetFile.create({
            data: { id: uuidv7(), assetVersionId: v.id, role: l.role, storageKey: l.file.key, bytes: l.file.bytes, mime: MIME.glb!, sha256: l.file.sha256 },
          });
        }
        await tx.assetVersion.update({
          where: { id: v.id },
          data: {
            status: 'ready',
            validationReport: { ...report, lods: stored.map((l) => ({ role: l.role, bytes: l.file.bytes, triangles: l.triangles })) } as unknown as Prisma.InputJsonValue,
            triangleCount: report.triangles,
            bounds: report.bounds as Prisma.InputJsonValue,
            licenseStatus: license,
          },
        });
        await tx.asset.update({ where: { id: v.assetId }, data: { status: 'ready', currentVersionId: v.id, version: { increment: 1 } } });
        await tx.assetProcessingJob.update({ where: { id: jobId }, data: { status: 'succeeded', finishedAt: new Date(), error: null } });
        await this.outbox.append(tx, {
          type: 'assets.version.ready',
          sourceModule: 'assets',
          aggregate: { type: 'asset', id: v.assetId },
          actor: { type: 'system', id: 'assets.worker' },
          data: { asset_id: v.assetId, version_id: v.id, number: v.number, license_status: license },
        });
      });
    } catch (e) {
      const message = (e as Error).message.slice(0, 500);
      this.logger.warn(`Varlık işleme hatası ${v.id}: ${message}`);
      await this.prisma.assetProcessingJob.update({
        where: { id: jobId },
        data: { status: job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', error: message, finishedAt: new Date() },
      });
    }
  }

  async list(filter: { kind?: AssetKind; status?: string; q?: string }) {
    const rows = await this.prisma.asset.findMany({
      where: {
        ...(filter.kind && { kind: filter.kind }),
        ...(filter.status ? { status: filter.status } : { status: { not: 'archived' } }),
        ...(filter.q && { name: { contains: filter.q, mode: 'insensitive' } }),
      },
      orderBy: { name: 'asc' },
      take: 500,
      include: { versions: { orderBy: { number: 'desc' }, take: 1, include: { files: true } }, licenses: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((a) => toSummary(a));
  }

  async get(id: string) {
    const a = await this.prisma.asset.findUnique({
      where: { id },
      include: { versions: { orderBy: { number: 'desc' }, include: { files: true, jobs: true } }, licenses: { orderBy: { createdAt: 'desc' } } },
    });
    if (!a) throw notFound('Varlık bulunamadı.');
    return {
      ...toSummary({ ...a, versions: a.versions.slice(0, 1), licenses: a.licenses.slice(0, 1) }),
      license_exception_reason: a.licenseExceptionReason,
      versions: a.versions.map((v) => ({
        id: v.id,
        number: v.number,
        status: v.status,
        license_status: v.licenseStatus,
        triangles: v.triangleCount,
        bounds: v.bounds,
        report: v.validationReport,
        files: v.files.map((f) => ({ role: f.role, key: f.storageKey, bytes: f.bytes })),
        job: v.jobs[0] ? { status: v.jobs[0].status, attempts: v.jobs[0].attempts, error: v.jobs[0].error } : null,
        created_at: v.createdAt,
      })),
      licenses: a.licenses.map((l) => ({ type: l.licenseType, source_url: l.sourceUrl, attribution: l.attribution, verified_at: l.verifiedAt })),
    };
  }

  /** Lisans kaydı; verify=true ise varlığın tüm sürümleri "verified" olur. */
  async setLicense(assetId: string, input: LicenseInput, ctx: AdminContext) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.asset.findUnique({ where: { id: assetId } }))) throw notFound('Varlık bulunamadı.');
      await this.writeLicense(tx, assetId, input, ctx);
    });
    return this.get(assetId);
  }

  /** K46: doğrulanmamış lisansa rağmen yayına izin (gerekçeli; null kaldırır). Yalnız platform yöneticisi. */
  async setLicenseException(assetId: string, reason: string | null, ctx: AdminContext) {
    if (reason !== null && reason.trim().length < 10) throw conflict('İstisna gerekçesi en az 10 karakter olmalı.');
    await this.prisma.$transaction(async (tx) => {
      const a = await tx.asset.findUnique({ where: { id: assetId } });
      if (!a) throw notFound('Varlık bulunamadı.');
      await tx.asset.update({
        where: { id: assetId },
        data: { licenseExceptionReason: reason?.trim() ?? null, licenseExceptionBy: reason ? ctx.actor.id : null, version: { increment: 1 } },
      });
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: reason ? 'assets.license.exception_granted' : 'assets.license.exception_revoked',
        entity: { type: 'asset', id: assetId },
        reason: reason ?? undefined,
        diff: { previous: a.licenseExceptionReason },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
    });
    return this.get(assetId);
  }

  /**
   * Sahne yayını öncesi (scene → assets): verilen varlık sürümlerinden yayına giremeyenler ve nedenleri.
   * Hazır olmayan sürüm teknik engeldir; lisans doğrulanmamışsa gerekçeli istisna yoksa engeldir (K46).
   */
  async publishProblems(versionIds: string[]): Promise<string[]> {
    if (versionIds.length === 0) return [];
    const rows = await this.prisma.assetVersion.findMany({ where: { id: { in: versionIds } }, include: { asset: true } });
    const problems: string[] = [];
    for (const id of versionIds) {
      const v = rows.find((r) => r.id === id);
      if (!v) problems.push(`Varlık sürümü bulunamadı: …${id.slice(-8)}`);
      else if (v.status !== 'ready') problems.push(`${v.asset.name} v${v.number} hazır değil (${v.status}).`);
      else if (v.licenseStatus !== 'verified' && !v.asset.licenseExceptionReason) {
        problems.push(`${v.asset.name}: lisans doğrulanmamış; lisansı doğrulayın ya da gerekçeli istisna verin.`);
      }
    }
    return problems;
  }

  /** Editör/istemci için dosya anahtarları: varlık sürümü → LOD dosyaları. */
  async files(versionIds: string[]) {
    const rows = await this.prisma.assetFile.findMany({ where: { assetVersionId: { in: versionIds }, role: { in: ['lod0', 'lod1', 'lod2'] } } });
    const out: Record<string, Record<string, string>> = {};
    for (const f of rows) (out[f.assetVersionId] ??= {})[f.role] = f.storageKey;
    return out;
  }

  fileExists(key: string) {
    return this.store.exists(key);
  }

  fileStream(key: string) {
    return this.store.stream(key);
  }

  private async licenseStatus(assetId: string): Promise<'verified' | 'unknown'> {
    const l = await this.prisma.assetLicense.findFirst({ where: { assetId, verifiedAt: { not: null } } });
    return l && (!l.validTo || l.validTo > new Date()) ? 'verified' : 'unknown';
  }

  private async writeLicense(tx: Prisma.TransactionClient, assetId: string, input: LicenseInput, ctx: AdminContext) {
    const now = new Date();
    await tx.assetLicense.create({
      data: {
        id: uuidv7(),
        assetId,
        licenseType: input.license_type,
        sourceUrl: input.source_url ?? null,
        attribution: input.attribution ?? null,
        verifiedBy: input.verify ? ctx.actor.id : null,
        verifiedAt: input.verify ? now : null,
      },
    });
    if (input.verify) await tx.assetVersion.updateMany({ where: { assetId, status: { not: 'rejected' } }, data: { licenseStatus: 'verified' } });
    await this.audit.write(tx, {
      actor: ctx.actor,
      action: input.verify ? 'assets.license.verified' : 'assets.license.recorded',
      entity: { type: 'asset', id: assetId },
      diff: { license_type: input.license_type, source_url: input.source_url ?? null },
      requestId: ctx.requestId,
      ipHash: ctx.ipHash,
    });
  }
}

type AssetRow = {
  id: string;
  kind: string;
  name: string;
  tags: string[];
  status: string;
  currentVersionId: string | null;
  licenseExceptionReason: string | null;
  versions: { id: string; number: number; status: string; licenseStatus: string; triangleCount: number | null; bounds: unknown; files: { role: string; storageKey: string; bytes: number }[] }[];
  licenses: { licenseType: string; verifiedAt: Date | null }[];
};

function toSummary(a: AssetRow) {
  const v = a.versions[0];
  const file = (role: string) => v?.files.find((f) => f.role === role);
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    tags: a.tags,
    status: a.status,
    current_version_id: a.currentVersionId,
    license: a.licenses[0] ? { type: a.licenses[0].licenseType, verified: a.licenses[0].verifiedAt !== null } : null,
    license_exception: a.licenseExceptionReason !== null,
    latest: v
      ? {
          id: v.id,
          number: v.number,
          status: v.status,
          license_status: v.licenseStatus,
          triangles: v.triangleCount,
          bounds: v.bounds,
          lod0: file('lod0')?.storageKey ?? null,
          lod0_bytes: file('lod0')?.bytes ?? null,
        }
      : null,
  };
}

async function streamToBuffer(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}
