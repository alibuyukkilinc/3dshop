import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import type { Tx } from '../../../infra/db/types.js';
import { AssetsService } from '../../assets/public/index.js';
import { OutboxWriter, type Publishable, type PublishContext, type PublishItem, PublishableRegistry } from '../../platform/public/index.js';

const Payload = z.object({ version_id: z.uuid() }).strict();

/**
 * Sahne yayını (K44, K45): canlı sürüm işaretçisi seçilen değişmez sürüme taşınır. Geri alma önceki sürüme
 * işaretçidir; içerik hiç değişmez. scene.version.published → bölge paketi derleme (F4, K48).
 */
@Injectable()
export class ScenePublishable implements Publishable, OnModuleInit {
  readonly entityType = 'scene';
  readonly label = 'Sahne';
  readonly ops = ['publish'];

  constructor(
    private readonly registry: PublishableRegistry,
    private readonly outbox: OutboxWriter,
    private readonly assets: AssetsService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async validate(tx: Tx, item: PublishItem): Promise<string[]> {
    if (!item.entityId) return ['Sahne seçilmedi.'];
    const p = Payload.safeParse(item.payload);
    if (!p.success) return ['Yayınlanacak sürüm seçilmedi.'];
    const v = await tx.sceneVersion.findUnique({ where: { id: p.data.version_id } });
    if (!v || v.sceneId !== item.entityId) return ['Sürüm bu sahneye ait değil.'];
    // Varlıklar hazır ve lisansı doğrulanmış (ya da gerekçeli istisnalı) olmalı (K46)
    return this.assets.publishProblems(v.assetVersionIds);
  }

  async snapshot(tx: Tx, entityId: string) {
    const s = await tx.scene.findUnique({ where: { id: entityId }, select: { liveVersionId: true } });
    return s ? { version_id: s.liveVersionId } : null;
  }

  async apply(tx: Tx, item: PublishItem, ctx: PublishContext) {
    const { version_id } = Payload.parse(item.payload);
    const scene = await tx.scene.update({ where: { id: item.entityId! }, data: { liveVersionId: version_id, version: { increment: 1 } } });
    const v = await tx.sceneVersion.findUniqueOrThrow({ where: { id: version_id }, select: { number: true } });
    await this.outbox.append(tx, {
      type: 'scene.version.published',
      sourceModule: 'scene',
      aggregate: { type: 'scene', id: scene.id },
      actor: ctx.actor,
      causationId: ctx.changesetId,
      data: { scene_id: scene.id, version_id, number: v.number, owner_type: scene.ownerType, owner_id: scene.ownerId },
    });
    return { entityId: scene.id };
  }

  inverse(before: Record<string, unknown> | null, item: PublishItem & { entityId: string }): PublishItem {
    // İlk yayının geri alınması: canlı sürüm yoktu; en yakın eşdeğer aynı sürümde kalmaktır (boş sahneye dönülmez)
    const prev = (before?.version_id as string | null | undefined) ?? (item.payload.version_id as string);
    return { entityType: 'scene', entityId: item.entityId, op: 'publish', payload: { version_id: prev } };
  }
}
