import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import type { Tx } from '../../../infra/db/types.js';
import { OutboxWriter, type Publishable, type PublishContext, type PublishItem, PublishableRegistry } from '../../platform/public/index.js';
import { insideTurkeyBox } from '../domain/geo.js';

const PinPayload = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    precision: z.enum(['exact', 'street', 'district_center', 'province_center']),
    address_line: z.string().trim().max(300).nullable().default(null),
  })
  .strict();

/**
 * Harita pini (şube konumu) yayını (K44: harita pini yayından geçer). Pilotta pinler ilçe merkezinde; yönetici
 * gerçek adresi girince hassasiyet "exact" olur ve doğrulama zamanı yazılır.
 */
@Injectable()
export class MapPinPublishable implements Publishable, OnModuleInit {
  readonly entityType = 'map_pin';
  readonly label = 'Harita pini (şube konumu)';
  readonly ops = ['update'];

  constructor(
    private readonly registry: PublishableRegistry,
    private readonly outbox: OutboxWriter,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async validate(tx: Tx, item: PublishItem): Promise<string[]> {
    if (!item.entityId) return ['Şube seçilmedi.'];
    const place = await tx.place.findUnique({ where: { id: item.entityId } });
    if (!place || place.kind !== 'branch') return ['Şube bulunamadı.'];
    const p = PinPayload.safeParse(item.payload);
    if (!p.success) return p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    if (!insideTurkeyBox(p.data.lat, p.data.lng)) return ['Konum Türkiye sınırları dışında görünüyor; enlem/boylam sırasını kontrol edin.'];
    return [];
  }

  async snapshot(tx: Tx, entityId: string) {
    const g = await tx.placeGeo.findUnique({ where: { placeId: entityId } });
    return g ? { lat: Number(g.lat), lng: Number(g.lng), precision: g.precision, address_line: g.addressLine } : null;
  }

  async apply(tx: Tx, item: PublishItem, ctx: PublishContext) {
    const p = PinPayload.parse(item.payload);
    const id = item.entityId!;
    await tx.placeGeo.update({
      where: { placeId: id },
      data: {
        lat: p.lat,
        lng: p.lng,
        precision: p.precision,
        addressLine: p.address_line,
        source: 'manual',
        verifiedAt: p.precision === 'exact' ? new Date() : null,
      },
    });
    await tx.place.update({ where: { id }, data: { version: { increment: 1 } } });
    await this.outbox.append(tx, {
      type: 'world.place.changed',
      sourceModule: 'world',
      aggregate: { type: 'place', id },
      actor: ctx.actor,
      causationId: ctx.changesetId,
      data: { place_id: id, kind: 'branch', changeset_id: ctx.changesetId },
    });
    return { entityId: id };
  }

  inverse(before: Record<string, unknown> | null, item: PublishItem & { entityId: string }): PublishItem {
    return { entityType: 'map_pin', entityId: item.entityId, op: 'update', payload: before ?? {} };
  }
}
