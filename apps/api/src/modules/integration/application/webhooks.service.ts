import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { loadEnv } from '../../../infra/config/env.js';
import { decryptSecret, encryptSecret, randomToken } from '../../../infra/crypto/secrets.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { type AdminContext, notFound } from '../../../infra/http/admin-request.js';
import { AuditWriter } from '../../audit/public/index.js';
import { isCircuitOpen } from '../domain/circuit.js';
import { WebhookBodySchema } from '../domain/webhook-payload.js';
import { verifyWebhook } from '../domain/webhook-signature.js';
import { SourceSyncService } from './source-sync.service.js';

const MAX_ATTEMPTS = 5;
const BATCH = 50;
const EVENT_ID_RE = /^[A-Za-z0-9._:-]{8,100}$/;

const reject = (status: HttpStatus, error: string, message: string) => new HttpException({ error, message }, status);

/**
 * Kaynak e-ticaret webhook'ları (F1.4, B2). Alıcı yalnız imzayı doğrular ve olayı gelen kutusuna yazar (hızlı
 * 202); işleme worker'da. Webhook yalnız tetikleyicidir: ürün export'tan tekil yeniden çekilir (K42).
 * Kaynak taraf (eticaret olay yayını) F5'e kadar gelmeyebilir; delta eşitleme o zamana kadar yeterli.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('integration.webhooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SourceSyncService,
    private readonly audit: AuditWriter,
  ) {}

  async receive(
    siteCode: string,
    headers: { eventId?: string; timestamp?: string; signature?: string },
    rawBody: Buffer | undefined,
  ): Promise<{ status: 'accepted' | 'duplicate' }> {
    const site = /^[a-z0-9_]{2,40}$/.test(siteCode) ? await this.prisma.sourceSite.findUnique({ where: { code: siteCode } }) : null;
    // Site yoksa ve sırrı yoksa aynı yanıt: dışarıdan site adı yoklanamasın
    if (!site?.webhookSecretEnc || !rawBody) throw reject(HttpStatus.UNAUTHORIZED, 'invalid_signature', 'İmza doğrulanamadı.');
    const check = verifyWebhook(decryptSecret(site.webhookSecretEnc, loadEnv().SECRETS_KEY), headers, rawBody);
    if (!check.ok) {
      this.logger.warn(`${siteCode}: webhook reddedildi (${check.reason})`);
      throw reject(HttpStatus.UNAUTHORIZED, 'invalid_signature', 'İmza doğrulanamadı.');
    }
    if (!headers.eventId || !EVENT_ID_RE.test(headers.eventId)) {
      throw reject(HttpStatus.BAD_REQUEST, 'invalid_event_id', 'X-DTD-Event-Id eksik ya da geçersiz.');
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw reject(HttpStatus.BAD_REQUEST, 'invalid_body', 'Gövde JSON değil.');
    }
    const body = WebhookBodySchema.safeParse(json);
    if (!body.success || body.data.site !== site.code) {
      throw reject(HttpStatus.BAD_REQUEST, 'invalid_body', 'Gövde beklenen biçimde değil.');
    }

    const now = new Date();
    const created = await this.prisma.webhookInbox.createMany({
      data: [
        {
          id: uuidv7(),
          sourceSiteId: site.id,
          eventId: headers.eventId,
          event: body.data.event,
          payload: body.data,
          // Sipariş/dönüşüm analitik modülünde (F5, K53) işlenecek; şimdilik saklanır
          status: body.data.event === 'order.created' ? 'deferred' : 'pending',
          receivedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    await this.prisma.sourceSite.update({ where: { id: site.id }, data: { lastWebhookAt: now } });
    return { status: created.count === 1 ? 'accepted' : 'duplicate' };
  }

  /** Bekleyen ürün olaylarını işler (worker). Aynı ürün bir partide bir kez çekilir. */
  async processPending(): Promise<{ processed: number; failed: number }> {
    const rows = await this.prisma.webhookInbox.findMany({
      where: { status: 'pending' },
      orderBy: { receivedAt: 'asc' },
      take: BATCH,
      include: { site: true },
    });
    let processed = 0;
    let failed = 0;
    const done = new Set<string>();
    for (const row of rows) {
      const site = row.site;
      if (site.status !== 'active' || !site.credentialsEnc || isCircuitOpen(site.circuitOpenUntil, new Date())) continue;
      const body = WebhookBodySchema.parse(row.payload);
      try {
        for (const externalId of body.product_ids) {
          const key = `${site.id}:${externalId}`;
          if (done.has(key)) continue;
          const r = await this.sync.refreshOne(site, externalId);
          if (r === 'missing' && body.event === 'product.deleted') await this.sync.markRemovedOne(site, externalId);
          done.add(key);
        }
        await this.prisma.webhookInbox.update({
          where: { id: row.id },
          data: { status: 'processed', processedAt: new Date(), attempts: { increment: 1 }, error: null },
        });
        processed++;
      } catch (e) {
        const attempts = row.attempts + 1;
        await this.prisma.webhookInbox.update({
          where: { id: row.id },
          data: { attempts, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', error: (e as Error).message.slice(0, 500) },
        });
        failed++;
      }
    }
    return { processed, failed };
  }

  /** Yeni imza sırrı üretir; düz hâli yalnız bu yanıtta döner (kaynak sitenin ayarına girilir). */
  async rotateSecret(code: string, ctx: AdminContext): Promise<{ secret: string; url_path: string }> {
    const secret = randomToken(32);
    await this.prisma.$transaction(async (tx) => {
      const site = await tx.sourceSite.findUnique({ where: { code } });
      if (!site) throw notFound('Kaynak site bulunamadı.');
      await tx.sourceSite.update({
        where: { code },
        data: { webhookSecretEnc: encryptSecret(secret, loadEnv().SECRETS_KEY), version: { increment: 1 } },
      });
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'integration.source_site.webhook_secret_rotated',
        entity: { type: 'source_site', id: site.id },
        diff: { had_secret: site.webhookSecretEnc !== null },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
    });
    return { secret, url_path: `/api/webhooks/sources/${code}` };
  }

  /** Panel için: son olaylar ve bekleyen/başarısız sayıları. */
  async recent(code: string, limit: number) {
    const site = await this.prisma.sourceSite.findUnique({ where: { code } });
    if (!site) throw notFound('Kaynak site bulunamadı.');
    const rows = await this.prisma.webhookInbox.findMany({
      where: { sourceSiteId: site.id },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      event_id: r.eventId,
      event: r.event,
      status: r.status,
      attempts: r.attempts,
      received_at: r.receivedAt,
      processed_at: r.processedAt,
      error: r.error,
      product_count: (r.payload as { product_ids?: unknown[] }).product_ids?.length ?? 0,
    }));
  }

  async countsBySite(): Promise<Record<string, { pending: number; failed: number }>> {
    const rows = await this.prisma.webhookInbox.groupBy({
      by: ['sourceSiteId', 'status'],
      where: { status: { in: ['pending', 'failed'] } },
      _count: { _all: true },
    });
    const out: Record<string, { pending: number; failed: number }> = {};
    for (const r of rows) {
      out[r.sourceSiteId] ??= { pending: 0, failed: 0 };
      out[r.sourceSiteId]![r.status as 'pending' | 'failed'] = r._count._all;
    }
    return out;
  }
}
