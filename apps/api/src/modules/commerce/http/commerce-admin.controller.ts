import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { adminContext, parseInput } from '../../../infra/http/admin-request.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';
import { CommerceAdminService } from '../application/commerce-admin.service.js';
import { StoreBrandingService } from '../application/store-branding.js';

const Version = z.number().int().positive();
const Name = z.string().trim().min(2).max(200);

const CompanyPatchSchema = z.object({
  version: Version,
  legal_name: Name.optional(),
  display_name: Name.optional(),
  tax_number: z.string().trim().regex(/^\d{10,11}$/, 'VKN 10, TCKN 11 hane').nullable().optional(),
  website: z.url().max(300).nullable().optional(),
});
const StorePatchSchema = z.object({ version: Version, name: Name.optional(), slug: z.string().trim().max(80).optional() });
const HttpsUrl = z.url().max(500).regex(/^https:\/\//, 'https adresi gerekli');
const BrandingSchema = z.object({ logo_url: HttpsUrl.nullable().optional(), icon_url: HttpsUrl.nullable().optional() });
const BrandCreateSchema = z.object({ name: z.string().trim().min(1).max(120), slug: z.string().trim().max(80).optional() });
const BrandPatchSchema = z.object({
  version: Version,
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

/** Firma, mağaza ve marka yönetimi (F1.3). Okuma tüm yöneticilere, yazma platform_admin'e açık. */
@Controller('admin/v1/commerce')
@UseGuards(AdminGuard)
export class CommerceAdminController {
  constructor(
    private readonly service: CommerceAdminService,
    private readonly branding: StoreBrandingService,
  ) {}

  @Get('companies')
  async companies() {
    return { items: await this.service.companies() };
  }

  @Patch('companies/:id')
  @RequireRoles('platform_admin')
  updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAdminSession() s: ResolvedSession,
    @Req() req: Request,
  ) {
    return this.service.updateCompany(id, parseInput(CompanyPatchSchema, body), adminContext(s.admin.id, req));
  }

  @Patch('stores/:id')
  @RequireRoles('platform_admin')
  updateStore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAdminSession() s: ResolvedSession,
    @Req() req: Request,
  ) {
    return this.service.updateStore(id, parseInput(StorePatchSchema, body), adminContext(s.admin.id, req));
  }

  /** Logo ve ikonu firmanın web sitesinden yeniden oku */
  @Post('stores/:id/branding/refresh')
  @RequireRoles('platform_admin')
  refreshBranding(@Param('id', ParseUUIDPipe) id: string, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.branding.refresh(id, adminContext(s.admin.id, req));
  }

  /** Logo/ikon adresini elle ver (null: kaldır) */
  @Patch('stores/:id/branding')
  @RequireRoles('platform_admin')
  async setBranding(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    const b = parseInput(BrandingSchema, body);
    return { changed: await this.branding.set(id, { logo: b.logo_url, icon: b.icon_url }, adminContext(s.admin.id, req)) };
  }

  @Get('brands')
  async brands() {
    return { items: await this.service.brands() };
  }

  @Post('brands')
  @RequireRoles('platform_admin')
  createBrand(@Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.service.createBrand(parseInput(BrandCreateSchema, body), adminContext(s.admin.id, req));
  }

  @Patch('brands/:id')
  @RequireRoles('platform_admin')
  updateBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAdminSession() s: ResolvedSession,
    @Req() req: Request,
  ) {
    return this.service.updateBrand(id, parseInput(BrandPatchSchema, body), adminContext(s.admin.id, req));
  }
}
