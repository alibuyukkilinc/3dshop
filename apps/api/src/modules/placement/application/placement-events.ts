import { Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@dtd/contracts';
import type { EventHandler } from '../../platform/public/index.js';
import { CONFIG_PUBLISHED } from './placement-publishable.js';
import { PlacementService } from './placement.service.js';

/** Yerleşimi etkileyen olaylar çalıştırmayı "kirli" işaretler; worker toplu çalıştırır (K23). */
@Injectable()
export class PlacementEventHandler implements EventHandler {
  /** inbox anahtarı: değiştirilmemeli */
  readonly name = 'placement.runs';
  readonly types = ['scene.version.published', 'rules.visibility.changed', 'catalog.product.updated', CONFIG_PUBLISHED];

  constructor(private readonly placement: PlacementService) {}

  async handle(event: EventEnvelope): Promise<void> {
    if (event.type === 'rules.visibility.changed') {
      const changed = (event.data.changed as { channel: string }[] | undefined) ?? [];
      if (!event.data.truncated && !changed.some((c) => c.channel === '3d')) return;
    }
    await this.placement.markDirty();
  }
}
