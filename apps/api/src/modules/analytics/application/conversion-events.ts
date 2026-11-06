import { Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@dtd/contracts';
import type { Tx } from '../../../infra/db/types.js';
import type { EventHandler } from '../../platform/public/index.js';
import { ConversionsService, type OrderReceived } from './conversions.service.js';

/** integration.order.received (adaptörün sipariş olayı) → dönüşüm eşleme (K53). */
@Injectable()
export class ConversionEventHandler implements EventHandler {
  /** inbox anahtarı: değiştirilmemeli */
  readonly name = 'analytics.conversions';
  /** Olay adı integration modülünde tanımlı; analytics ona bağımlı olmadığından metin olarak (K51) */
  readonly types = ['integration.order.received'];

  constructor(private readonly conversions: ConversionsService) {}

  async handle(event: EventEnvelope, tx: Tx): Promise<void> {
    await this.conversions.record(event.data as unknown as OrderReceived, tx);
  }
}
