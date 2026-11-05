import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { adminContext, parseInput } from '../../../infra/http/admin-request.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';
import { CatalogMappingService } from '../application/catalog-mapping.service.js';

const Uuid = z.uuid();
const CategoryName = z.string().trim().min(1).max(120);
const CategoryCreateSchema = z.object({
  name: CategoryName,
  parent_id: Uuid.nullable(),
  slug: z.string().trim().max(80).optional(),
  sort: z.number().int().min(0).max(10_000).optional(),
});
const CategoryPatchSchema = z.object({
  version: z.number().int().positive(),
  name: CategoryName.optional(),
  parent_id: Uuid.nullable().optional(),
  sort: z.number().int().min(0).max(10_000).optional(),
  status: z.enum(['active', 'archived']).optional(),
});
const ListFilterSchema = z.object({
  source_site_id: Uuid.optional(),
  unmapped: z
    .enum(['1', '0', 'true', 'false'])
    .transform((v) => v === '1' || v === 'true')
    .optional(),
});
/** catalog_category_id null: "bu kaynak kategoriyi bilerek eşleme" */
const CategoryMappingSchema = z.object({ catalog_category_id: Uuid.nullable() });
const BrandMappingSchema = z.object({
  source_site_id: Uuid,
  source_name: z.string().trim().min(1).max(200),
  /** null: "bu üretici adı marka değil" (örn. "Genel") */
  brand_id: Uuid.nullable(),
});

/** Platform kategori ağacı, kategori ve marka eşleme (F1.3). Okuma tüm yöneticilere, yazma platform_admin'e. */
@Controller('admin/v1/catalog')
@UseGuards(AdminGuard)
export class CatalogAdminController {
  constructor(private readonly mapping: CatalogMappingService) {}

  @Get('categories')
  async categories() {
    return { items: await this.mapping.categoryTree() };
  }

  @Post('categories')
  @RequireRoles('platform_admin')
  createCategory(@Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.mapping.createCategory(parseInput(CategoryCreateSchema, body), adminContext(s.admin.id, req));
  }

  @Patch('categories/:id')
  @RequireRoles('platform_admin')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAdminSession() s: ResolvedSession,
    @Req() req: Request,
  ) {
    return this.mapping.updateCategory(id, parseInput(CategoryPatchSchema, body), adminContext(s.admin.id, req));
  }

  @Get('source-categories')
  async sourceCategories(@Query() query: unknown) {
    return { items: await this.mapping.sourceCategories(parseInput(ListFilterSchema, query)) };
  }

  @Put('source-categories/:id/mapping')
  @RequireRoles('platform_admin')
  mapCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAdminSession() s: ResolvedSession,
    @Req() req: Request,
  ) {
    return this.mapping.mapSourceCategory(id, parseInput(CategoryMappingSchema, body), adminContext(s.admin.id, req));
  }

  @Get('source-brands')
  async sourceBrands(@Query() query: unknown) {
    return { items: await this.mapping.sourceBrands(parseInput(ListFilterSchema, query)) };
  }

  @Put('brand-mappings')
  @RequireRoles('platform_admin')
  mapBrand(@Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.mapping.mapSourceBrand(parseInput(BrandMappingSchema, body), adminContext(s.admin.id, req));
  }
}
