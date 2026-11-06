import { Body, Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { adminContext, parseInput } from '../../../infra/http/admin-request.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';
import { ScenesService } from '../application/scenes.service.js';

const Owner = z.object({ owner_type: z.enum(['world', 'region', 'store_interior', 'map']), owner_id: z.uuid() });
const EnsureSchema = Owner.extend({ name: z.string().trim().min(2).max(200) });
const SaveSchema = z.object({ base_number: z.number().int().positive(), document: z.unknown(), note: z.string().trim().max(500).optional() });
const DocQuery = z.object({ number: z.coerce.number().int().positive().optional() });

/** Sahne yönetimi (F3.3). Kaydetme editör ve platform yöneticisine; yayın değişiklik setiyle ('scene'). */
@Controller('admin/v1/scenes')
@UseGuards(AdminGuard)
export class ScenesAdminController {
  constructor(private readonly scenes: ScenesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const q = Owner.partial().parse(query);
    return { items: await this.scenes.list(q.owner_type && q.owner_id ? { type: q.owner_type, id: q.owner_id } : undefined) };
  }

  @Post()
  @RequireRoles('platform_admin', 'editor')
  ensure(@Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    const b = parseInput(EnsureSchema, body);
    return this.scenes.ensure({ type: b.owner_type, id: b.owner_id }, b.name, adminContext(s.admin.id, req));
  }

  @Get(':id/versions')
  versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.scenes.versions(id);
  }

  @Get(':id/document')
  document(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.scenes.document(id, parseInput(DocQuery, query).number);
  }

  @Post(':id/versions')
  @RequireRoles('platform_admin', 'editor')
  save(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.scenes.save(id, parseInput(SaveSchema, body), adminContext(s.admin.id, req));
  }
}

/** Yayındaki sahne belgesi (herkese açık; F4 istemcisi ve bölge paketi). Değişmez sürüm: uzun önbellek güvenli değil, kısa. */
@Controller('v1/scenes')
export class PublicScenesController {
  constructor(private readonly scenes: ScenesService) {}

  @Get(':id/live')
  @Header('Cache-Control', 'public, max-age=60')
  async live(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.scenes.live(id);
    if (!r) throw new NotFoundException({ error: 'not_found', message: 'Yayında sahne yok.' });
    return r;
  }
}
