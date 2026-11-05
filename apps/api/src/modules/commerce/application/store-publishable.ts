import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import type { Tx } from '../../../infra/db/types.js';
import { OutboxWriter, type Publishable, type PublishContext, type PublishItem, PublishableRegistry } from '../../platform/public/index.js';

const STATUS_BY_OP = { publish: 'active', unpublish: 'draft', archive: 'archived' } as const;
const UpdatePayload = z.object({ name: z.string().trim().min(2).max(200) }).strict();

/**
 * Mağaza yayını (K44): mağaza dünyaya ve vitrine yalnız yayınla açılır; taslak/arşiv mağaza her kanalda gizli
 * (SYS_STORE_NOT_PUBLISHED). Geri alma önceki duruma döner.
 */
@Injectable()
export class StorePublishable implements Publishable, OnModuleInit {
  readonly entityType = 'store';
  readonly label = 'Mağaza';
  readonly ops = ['publish', 'unpublish', 'archive', 'update'];

  constructor(
    private readonly registry: PublishableRegistry,
    private readonly outbox: OutboxWriter,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async validate(tx: Tx, item: PublishItem): Promise<string[]> {
    if (!item.entityId) return ['Mağaza seçilmedi.'];
    const store = await tx.store.findUnique({ where: { id: item.entityId }, include: { company: true, sources: true } });
    if (!store) return ['Mağaza bulunamadı.'];
    if (item.op === 'update') return UpdatePayload.safeParse(item.payload).success ? [] : ['Mağaza adı 2–200 karakter olmalı.'];
    const errors: string[] = [];
    if (item.op === 'publish') {
      if (store.company.displayName.trim().length < 2) errors.push('Firma adı girilmeden mağaza yayınlanamaz.');
      if (store.sources.length === 0) errors.push('Kaynak sitesi olmayan mağaza yayınlanamaz.');
    }
    return errors;
  }

  async snapshot(tx: Tx, entityId: string) {
    const s = await tx.store.findUnique({ where: { id: entityId }, select: { status: true, name: true } });
    return s ? { status: s.status, name: s.name } : null;
  }

  async apply(tx: Tx, item: PublishItem, ctx: PublishContext) {
    const id = item.entityId!;
    if (item.op === 'update') {
      const { name } = UpdatePayload.parse(item.payload);
      await tx.store.update({ where: { id }, data: { name, version: { increment: 1 } } });
      await this.event(tx, 'commerce.store.updated', id, ctx, { fields: ['name'] });
    } else {
      const status = STATUS_BY_OP[item.op as keyof typeof STATUS_BY_OP];
      await tx.store.update({ where: { id }, data: { status, version: { increment: 1 } } });
      const type = status === 'active' ? 'commerce.store.published' : status === 'archived' ? 'commerce.store.archived' : 'commerce.store.updated';
      await this.event(tx, type, id, ctx, { status });
    }
    return { entityId: id };
  }

  inverse(before: Record<string, unknown> | null, item: PublishItem & { entityId: string }): PublishItem {
    if (item.op === 'update') return { entityType: 'store', entityId: item.entityId, op: 'update', payload: { name: before?.name } };
    const op = before?.status === 'active' ? 'publish' : before?.status === 'archived' ? 'archive' : 'unpublish';
    return { entityType: 'store', entityId: item.entityId, op, payload: {} };
  }

  private event(tx: Tx, type: string, storeId: string, ctx: PublishContext, data: Record<string, unknown>) {
    return this.outbox.append(tx, {
      type,
      sourceModule: 'commerce',
      aggregate: { type: 'store', id: storeId },
      actor: ctx.actor,
      causationId: ctx.changesetId,
      data: { store_id: storeId, changeset_id: ctx.changesetId, ...data },
    });
  }
}
