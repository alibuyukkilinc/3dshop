import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseInput } from '../../../infra/http/admin-request.js';
import { StorefrontService } from '../application/storefront.service.js';

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const ProductsQuery = z.object({
  category: Slug.optional(),
  brand: Slug.optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'name']).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  in_stock: z
    .enum(['1', 'true'])
    .transform(() => true)
    .optional(),
});

const notFound = () => new NotFoundException({ error: 'not_found', message: 'Bulunamadı.' });

/**
 * Herkese açık 2D katalog API'si (B2: /api/v1). Kimlik doğrulama yok, yalnız okuma; yalnız 2d kanalında
 * görünenler döner. Kısa süreli önbellek: fiyat/stok kaynaktan dakikalar içinde güncellenir (K5).
 */
@Controller('v1')
export class PublicCatalogController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get('stores')
  @Header('Cache-Control', 'public, max-age=60')
  async stores() {
    return { items: await this.storefront.stores() };
  }

  @Get('stores/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  async store(@Param('slug') slug: string) {
    const s = await this.storefront.store(parseInput(Slug, slug));
    if (!s) throw notFound();
    return s;
  }

  @Get('stores/:slug/products')
  @Header('Cache-Control', 'public, max-age=60')
  async products(@Param('slug') slug: string, @Query() query: unknown) {
    const r = await this.storefront.storeProducts(parseInput(Slug, slug), parseInput(ProductsQuery, query));
    if (!r) throw notFound();
    return r;
  }

  @Get('products/:id')
  @Header('Cache-Control', 'public, max-age=60')
  async product(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.storefront.product(id);
    if (!p) throw notFound();
    return p;
  }
}
