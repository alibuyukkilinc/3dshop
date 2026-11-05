import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { adminContext, parseInput } from '../../../infra/http/admin-request.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';
import { ChangesetsService, type Preparer } from '../application/changesets.service.js';

const Item = z.object({
  entity_type: z.string().min(1).max(40),
  entity_id: z.uuid().nullable().optional(),
  op: z.string().min(1).max(40),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const CreateSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  items: z.array(Item).max(200).optional(),
});
const ApproveSchema = z.object({ comment: z.string().trim().max(1000).optional(), self_approval_reason: z.string().trim().max(1000).optional() });
const RejectSchema = z.object({ comment: z.string().trim().min(3).max(1000) });
const PublishSchema = z.object({ scheduled_at: z.iso.datetime({ offset: true }).nullable().optional() });
const ListQuery = z.object({ status: z.enum(['draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected', 'cancelled']).optional() });

const preparer = (s: ResolvedSession, req: Request): Preparer => ({ ...adminContext(s.admin.id, req), roles: s.admin.roles });

/**
 * Değişiklik setleri (F2.2, K44). Hazırlama: editor ya da platform_admin; onay/ret: approver; yayın: approver
 * ya da platform_admin. Esnek dört göz ve self_approved kuralı serviste.
 */
@Controller('admin/v1/changesets')
@UseGuards(AdminGuard)
export class ChangesetsController {
  constructor(private readonly changesets: ChangesetsService) {}

  @Get('entity-types')
  types() {
    return { items: this.changesets.entityTypes() };
  }

  @Get()
  async list(@Query() query: unknown) {
    return { items: await this.changesets.list(parseInput(ListQuery, query).status) };
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.changesets.get(id);
  }

  @Post()
  @RequireRoles('platform_admin', 'editor')
  create(@Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.create(parseInput(CreateSchema, body), preparer(s, req));
  }

  @Post(':id/items')
  @RequireRoles('platform_admin', 'editor')
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.addItem(id, parseInput(Item, body), preparer(s, req));
  }

  @Delete(':id/items/:itemId')
  @RequireRoles('platform_admin', 'editor')
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.changesets.removeItem(id, itemId);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequireRoles('platform_admin', 'editor')
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.submit(id, preparer(s, req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequireRoles('approver')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.approve(id, parseInput(ApproveSchema, body), preparer(s, req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequireRoles('approver')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.reject(id, parseInput(RejectSchema, body), preparer(s, req));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequireRoles('approver', 'platform_admin')
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.publish(id, parseInput(PublishSchema, body), preparer(s, req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireRoles('platform_admin', 'editor', 'approver')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.cancel(id, preparer(s, req));
  }

  @Post(':id/rollback')
  @RequireRoles('platform_admin', 'editor')
  rollback(@Param('id', ParseUUIDPipe) id: string, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.changesets.rollback(id, preparer(s, req));
  }
}
