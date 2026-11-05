import { Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';

/** Yönetim paneli "Sistem durumu": açık hatalar ve zamanlanmış işlerin son sonucu (yedek). */
@Controller('admin/v1/ops')
@UseGuards(AdminGuard)
export class OpsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('status')
  async status() {
    const [errors, jobs, openCount, deadLetters] = await Promise.all([
      this.prisma.errorEvent.findMany({
        where: { resolvedAt: null },
        orderBy: { lastSeenAt: 'desc' },
        take: 50,
        select: { fingerprint: true, source: true, name: true, message: true, count: true, firstSeenAt: true, lastSeenAt: true, lastContext: true },
      }),
      this.prisma.jobHeartbeat.findMany({ orderBy: { job: 'asc' } }),
      this.prisma.errorEvent.count({ where: { resolvedAt: null } }),
      this.prisma.outboxEvent.count({ where: { dead: true } }),
    ]);
    return {
      open_errors: openCount,
      dead_letters: deadLetters,
      errors: errors.map((e) => ({
        fingerprint: e.fingerprint,
        source: e.source,
        name: e.name,
        message: e.message,
        count: e.count,
        first_seen_at: e.firstSeenAt,
        last_seen_at: e.lastSeenAt,
        context: e.lastContext,
      })),
      jobs: jobs.map((j) => ({ job: j.job, ok: j.ok, finished_at: j.finishedAt, detail: j.detail })),
    };
  }

  @Post('errors/:fingerprint/resolve')
  @HttpCode(204)
  @RequireRoles('platform_admin')
  async resolve(@Param('fingerprint') fp: string, @CurrentAdminSession() session: ResolvedSession): Promise<void> {
    const r = await this.prisma.errorEvent.updateMany({
      where: { fingerprint: fp, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedBy: session.admin.id },
    });
    if (r.count === 0) throw new NotFoundException({ error: 'not_found', message: 'Açık hata bulunamadı.' });
  }
}
