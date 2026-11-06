import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { adminContext, parseInput } from '../../../infra/http/admin-request.js';
import { KEY_RE, MIME } from '../../../infra/storage/blob-store.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';
import { ASSET_KINDS, AssetsService, LICENSE_TYPES } from '../application/assets.service.js';

const UploadQuery = z.object({
  name: z.string().trim().min(2).max(200),
  kind: z.enum(ASSET_KINDS),
  asset_id: z.uuid().optional(),
  tags: z
    .string()
    .max(500)
    .transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20))
    .optional(),
});
const ListQuery = z.object({ kind: z.enum(ASSET_KINDS).optional(), status: z.string().max(20).optional(), q: z.string().max(100).optional() });
const LicenseSchema = z.object({
  license_type: z.enum(LICENSE_TYPES),
  source_url: z.url().max(500).nullable().optional(),
  attribution: z.string().trim().max(300).nullable().optional(),
  verify: z.boolean(),
});
const ExceptionSchema = z.object({ reason: z.string().trim().max(1000).nullable() });
const FilesQuery = z.object({ version_ids: z.string().transform((s) => s.split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500)) });

/**
 * 3D varlık kütüphanesi (F3.2). Yükleme: gövde doğrudan GLB (Content-Type: model/gltf-binary), ad ve tür
 * sorguda. Yazma editör/platform yöneticisine; lisans istisnası yalnız platform yöneticisine (K46).
 */
@Controller('admin/v1/assets')
@UseGuards(AdminGuard)
export class AssetsAdminController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  async list(@Query() query: unknown) {
    return { items: await this.assets.list(parseInput(ListQuery, query)) };
  }

  @Get('files')
  files(@Query() query: unknown) {
    return this.assets.files(parseInput(FilesQuery, query).version_ids);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.get(id);
  }

  @Post()
  @RequireRoles('platform_admin', 'editor')
  upload(@Query() query: unknown, @Req() req: Request, @CurrentAdminSession() s: ResolvedSession) {
    const q = parseInput(UploadQuery, query);
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException({ error: 'invalid_request', message: 'Gövde GLB olmalı (Content-Type: model/gltf-binary).' });
    }
    return this.assets.upload(req.body, q, adminContext(s.admin.id, req));
  }

  @Put(':id/license')
  @RequireRoles('platform_admin', 'editor')
  license(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.assets.setLicense(id, parseInput(LicenseSchema, body), adminContext(s.admin.id, req));
  }

  @Put(':id/license-exception')
  @RequireRoles('platform_admin')
  exception(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.assets.setLicenseException(id, parseInput(ExceptionSchema, body).reason, adminContext(s.admin.id, req));
  }
}

/** Varlık dosyaları (herkese açık, içerik adresli: değişmez → bir yıl önbellek). */
@Controller('v1/assets/files')
export class AssetFilesController {
  constructor(private readonly assets: AssetsService) {}

  @Get(':key')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  file(@Param('key') key: string, @Res() res: Response) {
    if (!KEY_RE.test(key) || !this.assets.fileExists(key)) throw new NotFoundException({ error: 'not_found', message: 'Dosya yok.' });
    res.setHeader('Content-Type', MIME[key.split('.').pop()!] ?? 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.assets.fileStream(key).pipe(res);
  }
}
