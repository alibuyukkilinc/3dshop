import { Injectable, type OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { z } from 'zod';
import type { Tx } from '../../../infra/db/types.js';
import { CatalogQuery } from '../../catalog/public/index.js';
import { OutboxWriter, type Publishable, type PublishContext, type PublishItem, PublishableRegistry } from '../../platform/public/index.js';

export const CONFIG_PUBLISHED = 'placement.config.published';

const Window = {
  valid_from: z.iso.datetime({ offset: true }).nullable().default(null),
  valid_to: z.iso.datetime({ offset: true }).nullable().default(null),
};
const windowError = (d: { valid_from: string | null; valid_to: string | null }) =>
  d.valid_from && d.valid_to && d.valid_from >= d.valid_to ? ['Geçerlilik bitişi başlangıçtan sonra olmalı.'] : [];

export const PlacementRuleSchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    store_id: z.uuid().nullable().default(null),
    category_id: z.uuid().nullable().default(null),
    brand_id: z.uuid().nullable().default(null),
    in_stock: z.boolean().default(false),
    sort_by: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'name']).default('relevance'),
    limit_per_slot: z.number().int().min(1).max(50).default(1),
    priority: z.number().int().min(-1000).max(1000).default(0),
    ...Window,
  })
  .strict();

export const PlacementPinSchema = z
  .object({
    slot_id: z.uuid(),
    position: z.number().int().min(0).max(49).default(0),
    product_id: z.uuid(),
    locked: z.boolean().default(true),
    reason: z.string().trim().min(3).max(500),
    ...Window,
  })
  .strict();

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'değer'}: ${i.message}`);

/** Yerleşim yapılandırması değişince bir kez: yeniden çalıştırma istenir. */
async function announce(outbox: OutboxWriter, tx: Tx, ctx: PublishContext, kind: string) {
  await outbox.append(tx, {
    type: CONFIG_PUBLISHED,
    sourceModule: 'placement',
    aggregate: { type: 'placement_config', id: ctx.changesetId },
    actor: ctx.actor,
    causationId: ctx.changesetId,
    data: { changeset_id: ctx.changesetId, kind },
  });
}

/** Yerleşim kuralı (K23, K44): hangi yuvaya mağazanın hangi ürünleri, hangi sırayla. */
@Injectable()
export class PlacementRulePublishable implements Publishable, OnModuleInit {
  readonly entityType = 'placement_rule';
  readonly label = 'Yerleşim kuralı';
  readonly ops = ['create', 'update', 'archive', 'activate'];

  constructor(
    private readonly registry: PublishableRegistry,
    private readonly outbox: OutboxWriter,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async validate(tx: Tx, item: PublishItem): Promise<string[]> {
    if (item.op === 'create') {
      if (item.entityId) return ['Yeni kural için kimlik verilmez.'];
    } else if (!item.entityId || !(await tx.placementRule.findUnique({ where: { id: item.entityId } }))) {
      return ['Yerleşim kuralı bulunamadı.'];
    }
    if (item.op === 'archive' || item.op === 'activate') return [];
    const p = PlacementRuleSchema.safeParse(item.payload);
    return p.success ? windowError(p.data) : issues(p.error);
  }

  async snapshot(tx: Tx, entityId: string) {
    const r = await tx.placementRule.findUnique({ where: { id: entityId } });
    if (!r) return null;
    return {
      name: r.name,
      store_id: r.storeId,
      category_id: r.categoryId,
      brand_id: r.brandId,
      in_stock: r.inStock,
      sort_by: r.sortBy,
      limit_per_slot: r.limitPerSlot,
      priority: r.priority,
      valid_from: r.validFrom?.toISOString() ?? null,
      valid_to: r.validTo?.toISOString() ?? null,
      status: r.status,
    };
  }

  async apply(tx: Tx, item: PublishItem) {
    if (item.op === 'archive' || item.op === 'activate') {
      await tx.placementRule.update({ where: { id: item.entityId! }, data: { status: item.op === 'archive' ? 'archived' : 'active', version: { increment: 1 } } });
      return { entityId: item.entityId! };
    }
    const d = PlacementRuleSchema.parse(item.payload);
    const fields = {
      name: d.name,
      storeId: d.store_id,
      categoryId: d.category_id,
      brandId: d.brand_id,
      inStock: d.in_stock,
      sortBy: d.sort_by,
      limitPerSlot: d.limit_per_slot,
      priority: d.priority,
      validFrom: d.valid_from ? new Date(d.valid_from) : null,
      validTo: d.valid_to ? new Date(d.valid_to) : null,
      status: 'active',
    };
    const id = item.entityId ?? uuidv7();
    if (item.op === 'create') await tx.placementRule.create({ data: { id, ...fields } });
    else await tx.placementRule.update({ where: { id }, data: { ...fields, version: { increment: 1 } } });
    return { entityId: id };
  }

  inverse(before: Record<string, unknown> | null, item: PublishItem & { entityId: string }): PublishItem {
    const base = { entityType: this.entityType, entityId: item.entityId };
    if (item.op === 'create' || before === null) return { ...base, op: 'archive', payload: {} };
    if (item.op === 'archive') return { ...base, op: 'activate', payload: {} };
    if (item.op === 'activate') return { ...base, op: 'archive', payload: {} };
    return { ...base, op: 'update', payload: Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'status')) };
  }

  async afterPublish(tx: Tx, ctx: PublishContext) {
    await announce(this.outbox, tx, ctx, 'rule');
  }
}

/** Elle sabitleme (K23): kuraldan önce gelir; kilitli pin otomatik çalıştırmada ezilmez. */
@Injectable()
export class PlacementPinPublishable implements Publishable, OnModuleInit {
  readonly entityType = 'placement_pin';
  readonly label = 'Yerleşim pini';
  readonly ops = ['create', 'remove', 'restore'];

  constructor(
    private readonly registry: PublishableRegistry,
    private readonly outbox: OutboxWriter,
    private readonly catalog: CatalogQuery,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async validate(tx: Tx, item: PublishItem): Promise<string[]> {
    if (item.op !== 'create') {
      const pin = item.entityId ? await tx.placementPin.findUnique({ where: { id: item.entityId } }) : null;
      return pin ? [] : ['Pin bulunamadı.'];
    }
    if (item.entityId) return ['Yeni pin için kimlik verilmez.'];
    const p = PlacementPinSchema.safeParse(item.payload);
    if (!p.success) return issues(p.error);
    const slot = await tx.placementSlot.findUnique({ where: { id: p.data.slot_id } });
    if (!slot || slot.status !== 'active') return ['Yuva bulunamadı ya da sahneden kalkmış.'];
    if (p.data.position >= slot.capacity) return [`Yuva kapasitesi ${slot.capacity}; pozisyon 0–${slot.capacity - 1} olmalı.`];
    // Ürün katalogda olmalı; görünürlük çalıştırmada denetlenir (görünmeyen pin yerleşmez, K43)
    const product = await this.catalog.detail(p.data.product_id);
    if (!product) return ['Ürün bulunamadı.'];
    const errors = windowError(p.data);
    if (slot.storeId && product.store_id !== slot.storeId) errors.push('Ürün bu yuvanın mağazasına ait değil.');
    return errors;
  }

  async snapshot(tx: Tx, entityId: string) {
    const p = await tx.placementPin.findUnique({ where: { id: entityId } });
    return p ? { slot_id: p.slotId, position: p.position, product_id: p.itemId, locked: p.locked, reason: p.reason, status: p.status } : null;
  }

  async apply(tx: Tx, item: PublishItem, ctx: PublishContext) {
    if (item.op === 'remove' || item.op === 'restore') {
      await tx.placementPin.update({ where: { id: item.entityId! }, data: { status: item.op === 'remove' ? 'removed' : 'active' } });
      return { entityId: item.entityId! };
    }
    const d = PlacementPinSchema.parse(item.payload);
    const id = uuidv7();
    await tx.placementPin.create({
      data: {
        id,
        slotId: d.slot_id,
        position: d.position,
        itemType: 'product',
        itemId: d.product_id,
        locked: d.locked,
        reason: d.reason,
        validFrom: d.valid_from ? new Date(d.valid_from) : null,
        validTo: d.valid_to ? new Date(d.valid_to) : null,
        createdBy: ctx.actor.id,
      },
    });
    return { entityId: id };
  }

  inverse(_before: Record<string, unknown> | null, item: PublishItem & { entityId: string }): PublishItem {
    return { entityType: this.entityType, entityId: item.entityId, op: item.op === 'remove' ? 'restore' : 'remove', payload: {} };
  }

  async afterPublish(tx: Tx, ctx: PublishContext) {
    await announce(this.outbox, tx, ctx, 'pin');
  }
}
