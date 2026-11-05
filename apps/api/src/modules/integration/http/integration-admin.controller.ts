import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { adminContext, parseInput } from '../../../infra/http/admin-request.js';
import { CatalogMappingService } from '../../catalog/public/index.js';
import { AdminGuard, CurrentAdminSession, RequireRoles, type ResolvedSession } from '../../identity/public/index.js';
import { SourceSitesService } from '../application/source-sites.service.js';
import { WebhooksService } from '../application/webhooks.service.js';
import { DELTA_INTERVAL_MS } from '../application/source-sync.service.js';
import { isCircuitOpen } from '../domain/circuit.js';
import { lastReconcileAt } from '../domain/schedule.js';

const Code = z.string().regex(/^[a-z0-9_]{2,40}$/);
const TokenSchema = z.object({ token: z.string().trim().min(20).max(2000) });
const SyncSchema = z.object({ kind: z.enum(['full', 'delta']) });
const StatusSchema = z.object({ status: z.enum(['active', 'paused']) });
const RunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export type SourceHealth = 'no_token' | 'paused' | 'failing' | 'stale' | 'ok';

/**
 * Kaynak siteler ve eşitleme izleme (F1.3). Token yalnız yazılır, hiçbir yanıtta geri dönmez.
 * Okuma tüm yöneticilere, yazma platform_admin'e açık.
 */
@Controller('admin/v1/integration')
@UseGuards(AdminGuard)
export class IntegrationAdminController {
  constructor(
    private readonly sites: SourceSitesService,
    private readonly catalog: CatalogMappingService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get('sources')
  async sources() {
    const now = new Date();
    const [sites, counts, hooks] = await Promise.all([this.sites.list(), this.catalog.siteCounts(), this.webhooks.countsBySite()]);
    const reconcileAt = lastReconcileAt(now);
    return {
      delta_interval_minutes: DELTA_INTERVAL_MS / 60_000,
      last_reconcile_window: reconcileAt,
      items: sites.map((s) => {
        const deltaAge = s.lastDeltaSyncAt ? now.getTime() - s.lastDeltaSyncAt.getTime() : null;
        // Sağlık: F1 tamamlanma şartı delta ≤ 10 dk
        let health: SourceHealth = 'ok';
        if (!s.hasToken) health = 'no_token';
        else if (s.status === 'paused') health = 'paused';
        else if (isCircuitOpen(s.circuitOpenUntil, now) || s.consecutiveFailures > 0) health = 'failing';
        else if (deltaAge === null || deltaAge > 2 * DELTA_INTERVAL_MS) health = 'stale';
        return {
          id: s.id,
          code: s.code,
          base_url: s.baseUrl,
          store_id: s.storeId,
          status: s.status,
          health,
          has_token: s.hasToken,
          watermark: s.watermark,
          last_full_sync_at: s.lastFullSyncAt,
          last_delta_sync_at: s.lastDeltaSyncAt,
          reconciled_in_window: s.lastFullSyncAt !== null && s.lastFullSyncAt >= reconcileAt,
          consecutive_failures: s.consecutiveFailures,
          circuit_open_until: s.circuitOpenUntil,
          last_error: s.lastError,
          last_run: s.lastRun,
          catalog: counts[s.id] ?? { total: 0, active: 0, priced: 0, unmapped_categories: 0 },
          webhook: {
            has_secret: s.hasWebhookSecret,
            last_received_at: s.lastWebhookAt,
            ...(hooks[s.id] ?? { pending: 0, failed: 0 }),
          },
        };
      }),
    };
  }

  @Get('sources/:code/runs')
  async runs(@Param('code') code: string, @Query() query: unknown) {
    const { limit } = parseInput(RunsQuery, query);
    return { items: await this.sites.runs(parseInput(Code, code), limit) };
  }

  @Get('sources/:code/webhooks')
  async recentWebhooks(@Param('code') code: string, @Query() query: unknown) {
    const { limit } = parseInput(RunsQuery, query);
    return { items: await this.webhooks.recent(parseInput(Code, code), limit) };
  }

  /** Yeni webhook sırrı: düz hâli yalnız bu yanıtta döner; eskisi hemen geçersiz olur. */
  @Post('sources/:code/webhook-secret')
  @RequireRoles('platform_admin')
  rotateWebhookSecret(@Param('code') code: string, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    return this.webhooks.rotateSecret(parseInput(Code, code), adminContext(s.admin.id, req));
  }

  @Put('sources/:code/token')
  @HttpCode(204)
  @RequireRoles('platform_admin')
  async token(
    @Param('code') code: string,
    @Body() body: unknown,
    @CurrentAdminSession() s: ResolvedSession,
    @Req() req: Request,
  ): Promise<void> {
    const { token } = parseInput(TokenSchema, body);
    await this.sites.setToken(parseInput(Code, code), token, adminContext(s.admin.id, req));
  }

  @Post('sources/:code/sync')
  @HttpCode(202)
  @RequireRoles('platform_admin')
  async sync(@Param('code') code: string, @Body() body: unknown, @CurrentAdminSession() s: ResolvedSession, @Req() req: Request) {
    const { kind } = parseInput(SyncSchema, body);
    await this.sites.requestSync(parseInput(Code, code), kind, adminContext(s.admin.id, req));
    return { queued: true, kind };
  }

  @Put('sources/:code/status')
  @HttpCode(204)
  @RequireRoles('platform_admin')
  async status(
    @Param('code') code: string,
    @Body() body: unknown,
    @CurrentAdminSession() s: ResolvedSession,
    @Req() req: Request,
  ): Promise<void> {
    const { status } = parseInput(StatusSchema, body);
    await this.sites.setStatus(parseInput(Code, code), status, adminContext(s.admin.id, req));
  }
}
