import { Injectable } from '@nestjs/common';
import type { Actor } from '@dtd/contracts';
import type { Tx } from '../../../infra/db/types.js';

/**
 * Yayınlanabilir varlık bağdaştırıcısı (K44, moduller/B1 "Publishable arayüzü"). Yayından geçen her modül
 * (rules, commerce, ileride scene, world…) kendi bağdaştırıcısını buraya kaydeder; publishing modülü onları
 * yalnız bu arayüzle çağırır. Kayıt defteri çekirdekte (platform): böylece hiçbir domain modülü publishing'e,
 * publishing de onlara bağımlı olmaz (K51).
 */
export interface PublishItem {
  entityType: string;
  /** create işleminde boş olabilir; bağdaştırıcı kimliği apply'da üretir */
  entityId: string | null;
  op: string;
  payload: Record<string, unknown>;
}

export interface PublishContext {
  actor: Actor;
  changesetId: string;
  /** Changeset'i hazırlayanın rolleri (ör. hukuki engel yalnız platform_admin, K44) */
  preparerRoles: string[];
}

export interface Publishable {
  entityType: string;
  /** İnsan okur: "Mağaza", "Görünürlük kuralı" */
  label: string;
  ops: string[];
  /** Taslağa eklenirken ve yayından hemen önce; sorun varsa insan okunur hata mesajları */
  validate(tx: Tx, item: PublishItem, ctx: PublishContext): Promise<string[]>;
  /** Şu anki canlı durum (geri alma için); yoksa null */
  snapshot(tx: Tx, entityId: string): Promise<Record<string, unknown> | null>;
  /** Uygular; entityId döner (create'te yeni üretilen). Kendi olaylarını aynı tx'te outbox'a yazar. */
  apply(tx: Tx, item: PublishItem, ctx: PublishContext): Promise<{ entityId: string }>;
  /** Geri alma: snapshot'a dönmek için gereken işlem */
  inverse(before: Record<string, unknown> | null, item: PublishItem & { entityId: string }): PublishItem;
  /** Bu changeset'teki tüm öğeler uygulandıktan sonra bir kez (ör. kural seti sürümü artırma) */
  afterPublish?(tx: Tx, ctx: PublishContext): Promise<void>;
}

@Injectable()
export class PublishableRegistry {
  private readonly adapters = new Map<string, Publishable>();

  register(adapter: Publishable): void {
    if (this.adapters.has(adapter.entityType)) throw new Error(`Yayın bağdaştırıcısı iki kez kaydedildi: ${adapter.entityType}`);
    this.adapters.set(adapter.entityType, adapter);
  }

  get(entityType: string): Publishable | undefined {
    return this.adapters.get(entityType);
  }

  list(): Publishable[] {
    return [...this.adapters.values()];
  }
}
