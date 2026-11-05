import { Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@dtd/contracts';
import type { Tx } from '../../../infra/db/types.js';
import type { EventHandler } from '../../platform/public/index.js';
import { type RecomputeScope, VisibilityService } from './visibility.service.js';

/**
 * Olayla artımlı yeniden hesap (K43): katalog ve ticari yapı değişince yalnız etkilenen hedefler hesaplanır.
 * Kural seti değişince (F2.2 yayın) ve saatlik tam hesap worker'da ayrıca çalışır.
 */
@Injectable()
export class VisibilityEventHandler implements EventHandler {
  /** inbox anahtarı: değiştirilmemeli */
  readonly name = 'rules.visibility';
  readonly types = [
    'catalog.product.created',
    'catalog.product.updated',
    'catalog.product.removed',
    'catalog.category_mapping.changed',
    'catalog.brand_mapping.changed',
    'commerce.store.updated',
    'commerce.store.published',
    'commerce.store.archived',
    'rules.ruleset.published',
  ];

  constructor(private readonly visibility: VisibilityService) {}

  async handle(event: EventEnvelope, tx: Tx): Promise<void> {
    const scope = scopeFor(event);
    if (scope) await this.visibility.recompute(scope, tx);
  }
}

export function scopeFor(event: EventEnvelope): RecomputeScope | null {
  if (event.type === 'rules.ruleset.published') return { all: true };
  const d = event.data as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  if (event.type.startsWith('catalog.product.')) {
    const id = str('product_id');
    return id ? { productIds: [id] } : null;
  }
  if (event.type === 'catalog.category_mapping.changed' || event.type === 'catalog.brand_mapping.changed') {
    const site = str('source_site_id');
    return site ? { sourceSiteIds: [site] } : null;
  }
  if (event.type.startsWith('commerce.store.')) {
    const id = str('store_id');
    // Mağaza ve bütün ürünleri (mağaza durumu ürünlerin olgusudur)
    return id ? { storeIds: [id] } : null;
  }
  return null;
}
