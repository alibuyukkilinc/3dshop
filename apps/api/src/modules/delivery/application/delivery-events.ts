import { Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@dtd/contracts';
import { PLACEMENT_LIVE_CHANGED } from '../../placement/public/index.js';
import type { EventHandler } from '../../platform/public/index.js';
import { BundlesService } from './bundles.service.js';

/** Paketi etkileyen olaylar paketleri "kirli" işaretler; worker toplu derler (K48). */
@Injectable()
export class DeliveryEventHandler implements EventHandler {
  /** inbox anahtarı: değiştirilmemeli */
  readonly name = 'delivery.bundles';
  readonly types = ['scene.version.published', 'rules.visibility.changed', 'assets.version.ready', 'commerce.store.updated', PLACEMENT_LIVE_CHANGED];

  constructor(private readonly bundles: BundlesService) {}

  async handle(event: EventEnvelope): Promise<void> {
    if (event.type === 'rules.visibility.changed') {
      // Yalnız 3d kanalındaki değişiklik paketi etkiler
      const changed = (event.data.changed as { channel: string }[] | undefined) ?? [];
      if (!event.data.truncated && !changed.some((c) => c.channel === '3d')) return;
    }
    await this.bundles.markDirty();
  }
}
