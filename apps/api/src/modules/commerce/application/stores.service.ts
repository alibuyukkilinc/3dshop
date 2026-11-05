import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import type { Tx } from '../../../infra/db/types.js';

export interface StoreSeed {
  /** Kalıcı adres parçası; aynı slug ikinci kez verilirse mevcut mağaza döner */
  slug: string;
  storeName: string;
  companyDisplayName: string;
  companyLegalName?: string;
  website?: string;
}

/**
 * Firma ve mağaza kaydı (A2, K39). F1.1 kapsamı: pilot için 1 firma = 1 mağaza = 1 kaynak site.
 * Düzenleme ekranları F1.3'te.
 */
@Injectable()
export class StoresService {
  /** Mağazayı (ve firmasını) yoksa açar. Mağaza "draft" başlar: dünyaya çıkması yayınla olur (K44). */
  async ensureStore(tx: Tx, seed: StoreSeed): Promise<{ storeId: string; companyId: string; created: boolean }> {
    const existing = await tx.store.findUnique({ where: { slug: seed.slug } });
    if (existing) return { storeId: existing.id, companyId: existing.companyId, created: false };
    const company = await tx.company.create({
      data: {
        id: uuidv7(),
        legalName: seed.companyLegalName ?? seed.companyDisplayName,
        displayName: seed.companyDisplayName,
        website: seed.website ?? null,
      },
    });
    const store = await tx.store.create({
      data: { id: uuidv7(), companyId: company.id, name: seed.storeName, slug: seed.slug },
    });
    return { storeId: store.id, companyId: company.id, created: true };
  }

  /** Mağazayı bir kaynak siteye bağlar (store_sources). Kaynak site integration'dadır: yalnız kimlik (K32). */
  async linkSource(tx: Tx, storeId: string, sourceSiteId: string): Promise<void> {
    await tx.storeSource.upsert({
      where: { sourceSiteId },
      create: { id: uuidv7(), storeId, sourceSiteId },
      update: { storeId },
    });
  }
}
