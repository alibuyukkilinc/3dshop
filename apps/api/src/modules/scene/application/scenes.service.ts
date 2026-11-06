import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { type SceneDocument, SceneDocumentSchema } from '@dtd/scene-runtime/schema';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { type AdminContext, conflict, notFound } from '../../../infra/http/admin-request.js';
import { AuditWriter } from '../../audit/public/index.js';
import { assetVersionIds, documentChecksum, indexNodes } from '../domain/scene-index.js';

export type OwnerType = 'world' | 'region' | 'store_interior' | 'map';

/** Sınırlar: mobilde bölge paketi ≤ 15 MB (K3); belge tarafında düğüm sayısı makul tutulur. */
export const MAX_NODES = 5_000;

const EMPTY: SceneDocument = SceneDocumentSchema.parse({
  schema: 'dtd.scene.v1',
  units: 'm',
  nodes: [
    { id: 'isik-gok', parent: null, name: 'Gök ışığı', components: [{ type: 'light', kind: 'hemispheric', intensity: 0.8 }] },
    {
      id: 'isik-gunes',
      parent: null,
      name: 'Güneş',
      components: [{ type: 'light', kind: 'directional', intensity: 1.2, direction: [-0.5, -1, -0.3], shadows: true }],
    },
    {
      id: 'zemin',
      parent: null,
      name: 'Zemin',
      components: [{ type: 'primitive', shape: 'plane', size: [160, 240], material: { color: '#9aa39a' }, castShadow: false }],
    },
  ],
});

const invalid = (errors: string[]) =>
  new HttpException({ error: 'invalid_scene', message: errors.slice(0, 5).join(' '), errors }, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * Sahneler ve değişmez sürümleri (K45). Kaydetmek yeni sürüm yaratır (aynı içerik ikinci kez değil); canlıya
 * çıkmak yayınla (publishing, 'scene' bağdaştırıcısı). İyimser kilit: istemci son gördüğü sürüm numarasını yollar.
 */
@Injectable()
export class ScenesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async list(owner?: { type: OwnerType; id: string }) {
    const rows = await this.prisma.scene.findMany({
      where: owner ? { ownerType: owner.type, ownerId: owner.id } : {},
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { number: 'desc' }, take: 1, select: { id: true, number: true, createdAt: true } } },
    });
    return rows.map((s) => ({
      id: s.id,
      owner_type: s.ownerType,
      owner_id: s.ownerId,
      name: s.name,
      status: s.status,
      live_version_id: s.liveVersionId,
      latest: s.versions[0] ? { id: s.versions[0].id, number: s.versions[0].number, created_at: s.versions[0].createdAt } : null,
    }));
  }

  /** Sahibine sahne açar (yoksa) ve boş başlangıç sürümünü (ışık + zemin) yazar. */
  async ensure(owner: { type: OwnerType; id: string }, name: string, ctx: AdminContext) {
    const existing = await this.prisma.scene.findUnique({ where: { ownerType_ownerId: { ownerType: owner.type, ownerId: owner.id } } });
    if (existing) return { id: existing.id, created: false };
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.scene.create({ data: { id, ownerType: owner.type, ownerId: owner.id, name } });
      await this.writeVersion(tx, id, 1, EMPTY, 'Boş başlangıç', ctx.actor.id);
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'scene.scene.created',
        entity: { type: 'scene', id },
        diff: { owner_type: owner.type, owner_id: owner.id, name },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
    });
    return { id, created: true };
  }

  async versions(sceneId: string) {
    const s = await this.prisma.scene.findUnique({ where: { id: sceneId } });
    if (!s) throw notFound('Sahne bulunamadı.');
    const rows = await this.prisma.sceneVersion.findMany({
      where: { sceneId },
      orderBy: { number: 'desc' },
      take: 50,
      select: { id: true, number: true, note: true, createdBy: true, createdAt: true, checksum: true },
    });
    return {
      scene: { id: s.id, name: s.name, owner_type: s.ownerType, owner_id: s.ownerId, live_version_id: s.liveVersionId },
      items: rows.map((v) => ({ id: v.id, number: v.number, note: v.note, created_by: v.createdBy, created_at: v.createdAt, live: v.id === s.liveVersionId })),
    };
  }

  async document(sceneId: string, number?: number) {
    const v = await this.prisma.sceneVersion.findFirst({
      where: { sceneId, ...(number !== undefined && { number }) },
      orderBy: { number: 'desc' },
    });
    if (!v) throw notFound('Sahne sürümü bulunamadı.');
    return { version_id: v.id, number: v.number, document: v.document };
  }

  /** Yeni sürüm kaydeder. base_number en son sürüm değilse 409 (başka biri kaydetti). */
  async save(sceneId: string, input: { base_number: number; document: unknown; note?: string }, ctx: AdminContext) {
    const parsed = SceneDocumentSchema.safeParse(input.document);
    if (!parsed.success) throw invalid(parsed.error.issues.map((i) => `${i.path.join('.') || 'belge'}: ${i.message}`));
    const doc = parsed.data;
    if (doc.nodes.length > MAX_NODES) throw invalid([`En çok ${MAX_NODES} düğüm.`]);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM scene.scenes WHERE id = ${sceneId}::uuid FOR UPDATE`;
      const latest = await tx.sceneVersion.findFirst({ where: { sceneId }, orderBy: { number: 'desc' } });
      if (!latest) throw notFound('Sahne bulunamadı.');
      if (latest.number !== input.base_number) throw conflict(`Sahne siz düzenlerken değişti (son sürüm ${latest.number}). Yenileyin.`);
      if (latest.checksum === documentChecksum(doc)) return { version_id: latest.id, number: latest.number, unchanged: true };
      const v = await this.writeVersion(tx, sceneId, latest.number + 1, doc, input.note ?? null, ctx.actor.id);
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'scene.version.saved',
        entity: { type: 'scene', id: sceneId },
        diff: { number: v.number, nodes: doc.nodes.length },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
      return { version_id: v.id, number: v.number, unchanged: false };
    });
  }

  /** Yayındaki belge (istemci, F4 bölge paketi). */
  async live(sceneId: string) {
    const s = await this.prisma.scene.findUnique({ where: { id: sceneId } });
    if (!s?.liveVersionId) return null;
    const v = await this.prisma.sceneVersion.findUniqueOrThrow({ where: { id: s.liveVersionId } });
    return { scene_id: s.id, version_id: v.id, number: v.number, checksum: v.checksum, document: v.document };
  }

  private async writeVersion(tx: Prisma.TransactionClient, sceneId: string, number: number, doc: SceneDocument, note: string | null, by: string) {
    const id = uuidv7();
    await tx.sceneVersion.create({
      data: {
        id,
        sceneId,
        number,
        schemaVersion: doc.schema,
        document: doc as unknown as Prisma.InputJsonValue,
        assetVersionIds: assetVersionIds(doc),
        checksum: documentChecksum(doc),
        note,
        createdBy: by,
      },
    });
    const idx = indexNodes(doc);
    if (idx.length) await tx.sceneNodeIndex.createMany({ data: idx.map((n) => ({ sceneVersionId: id, ...n })) });
    return { id, number };
  }
}
