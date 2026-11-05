import { Controller, Get, HttpCode, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseInput } from '../../../infra/http/admin-request.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { AdminGuard, RequireRoles } from '../../identity/public/index.js';
import { VisibilityService } from '../application/visibility.service.js';
import { CHANNELS } from '../domain/evaluate.js';

const ExplainQuery = z.object({
  target_type: z.enum(['product', 'store']),
  target_id: z.uuid(),
  channel: z.enum(CHANNELS),
});

/** Kurallar ve "neden görünmüyor?" açıklaması (F2.1). Kural yazımı yayın akışıyla gelir (F2.2, K44). */
@Controller('admin/v1/rules')
@UseGuards(AdminGuard)
export class RulesAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: VisibilityService,
  ) {}

  @Get()
  async list() {
    const [rules, version, stats] = await Promise.all([
      this.prisma.rule.findMany({
        orderBy: [{ status: 'asc' }, { layer: 'asc' }, { priority: 'desc' }, { code: 'asc' }],
        include: { targets: true, channels: true },
      }),
      this.visibility.rulesetVersion(),
      this.prisma.visibilityResolved.groupBy({ by: ['channel', 'targetType', 'visible'], _count: { _all: true } }),
    ]);
    return {
      ruleset_version: version,
      summary: stats.map((s) => ({ channel: s.channel, target_type: s.targetType, visible: s.visible, count: s._count._all })),
      items: rules.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        layer: r.layer,
        effect: r.effect,
        effect_params: r.effectParams,
        condition: r.condition,
        priority: r.priority,
        legal_ref: r.legalRef,
        reason: r.reason,
        valid_from: r.validFrom,
        valid_to: r.validTo,
        status: r.status,
        system: r.system,
        version: r.version,
        targets: r.targets.map((t) => ({ type: t.targetType, id: t.targetId, include: t.include })),
        channels: r.channels.map((c) => c.channel),
      })),
    };
  }

  @Get('explain')
  async explain(@Query() query: unknown) {
    const q = parseInput(ExplainQuery, query);
    const r = await this.visibility.explain(q.target_type, q.target_id, q.channel);
    if (!r) throw new NotFoundException({ error: 'not_found', message: 'Hedef bulunamadı.' });
    return r;
  }

  /** Tam yeniden hesap (normalde saatlik ve olayla); yönetici beklemek istemezse. */
  @Post('recompute')
  @HttpCode(200)
  @RequireRoles('platform_admin')
  recompute() {
    return this.visibility.recompute({ all: true });
  }
}
