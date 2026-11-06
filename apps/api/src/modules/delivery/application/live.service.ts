import { Injectable } from '@nestjs/common';
import { CatalogQuery } from '../../catalog/public/index.js';
import { VisibilityService } from '../../rules/public/index.js';

/**
 * Canlı fiyat/stok katmanı (K48): bölgedeki ürün kimlikleri için toplu, hafif. Fiyat kaynağın son fiyatıdır
 * (K41). Yalnız 3d ya da 2d kanalında görünen ürünler döner. Redis gelince önbellek oraya taşınır; şimdilik
 * HTTP önbelleği (30 sn).
 */
@Injectable()
export class LiveService {
  constructor(
    private readonly catalog: CatalogQuery,
    private readonly visibility: VisibilityService,
  ) {}

  async prices(ids: string[]) {
    const [v3, v2] = await Promise.all([this.visibility.visibleIds('product', '3d', ids), this.visibility.visibleIds('product', '2d', ids)]);
    const visible = ids.filter((id) => v3.has(id) || v2.has(id));
    const { items } = await this.catalog.list({ productIds: visible, sort: 'name', offset: 0, limit: visible.length });
    return {
      items: items.map((p) => ({ product_id: p.id, price: p.price, in_stock: p.in_stock })),
      as_of: new Date().toISOString(),
    };
  }
}
