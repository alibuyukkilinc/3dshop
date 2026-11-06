import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';

/** Yönlendirmeden sonra bu süre içinde gelen sipariş eşleşir (son tıklama, K53) */
export const ATTRIBUTION_DAYS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrderReceived {
  source_site_id: string;
  order_id: string;
  amount_minor: number | null;
  currency: string | null;
  dtd_rid: string | null;
  received_at: string;
}

/**
 * Dönüşüm eşleme (K53, K15): kaynak sitenin sipariş olayı dtd_rid ile yönlendirmeye bağlanır. Eşleşme şartı:
 * yönlendirme var, aynı kaynak siteye gitmiş, sipariş yönlendirmeden sonra ve 30 gün içinde. Aynı sipariş ikinci
 * kez gelirse yok sayılır. Kişisel veri tutulmaz.
 */
@Injectable()
export class ConversionsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(o: OrderReceived, tx: Tx = this.prisma): Promise<'matched' | 'unmatched' | 'duplicate'> {
    const key = { sourceSiteId_externalOrderId: { sourceSiteId: o.source_site_id, externalOrderId: o.order_id } };
    if (await tx.conversion.findUnique({ where: key })) return 'duplicate';
    const receivedAt = new Date(o.received_at);
    let redirectId: string | null = null;
    if (o.dtd_rid && UUID_RE.test(o.dtd_rid)) {
      const r = await tx.redirect.findUnique({ where: { id: o.dtd_rid.toLowerCase() } });
      const ageMs = r ? receivedAt.getTime() - r.createdAt.getTime() : -1;
      const sameSite = r && (!r.sourceSiteId || r.sourceSiteId === o.source_site_id);
      if (r && sameSite && ageMs >= 0 && ageMs <= ATTRIBUTION_DAYS * 86_400_000) redirectId = r.id;
    }
    await tx.conversion.create({
      data: {
        id: uuidv7(),
        redirectId,
        sourceSiteId: o.source_site_id,
        externalOrderId: o.order_id,
        amountMinor: o.amount_minor === null ? null : BigInt(o.amount_minor),
        currency: o.currency,
        matchedAt: redirectId ? new Date() : null,
        receivedAt,
      },
    });
    return redirectId ? 'matched' : 'unmatched';
  }

  /** Yönetim özeti: son N gün yönlendirme ve eşleşen sipariş; kanal ve mağaza kırılımı. */
  async summary(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [redirects, conversions] = await Promise.all([
      this.prisma.redirect.groupBy({ by: ['channel', 'storeId'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.conversion.findMany({ where: { receivedAt: { gte: since } }, orderBy: { receivedAt: 'desc' } }),
    ]);
    const matched = conversions.filter((c) => c.redirectId);
    const rmap = new Map((await this.prisma.redirect.findMany({ where: { id: { in: matched.map((c) => c.redirectId!) } } })).map((r) => [r.id, r]));
    const byKey = new Map<string, { channel: string; store_id: string; redirects: number; orders: number; amount_minor: number }>();
    const row = (channel: string, storeId: string) => {
      const k = `${channel}:${storeId}`;
      if (!byKey.has(k)) byKey.set(k, { channel, store_id: storeId, redirects: 0, orders: 0, amount_minor: 0 });
      return byKey.get(k)!;
    };
    for (const g of redirects) row(g.channel, g.storeId).redirects += g._count._all;
    for (const c of matched) {
      const r = rmap.get(c.redirectId!);
      if (!r) continue;
      const x = row(r.channel, r.storeId);
      x.orders++;
      // Tutar yalnız TRY toplanır (pilot); diğer para birimleri listede ayrı görünür
      if (c.amountMinor !== null && (c.currency ?? 'TRY') === 'TRY') x.amount_minor += Number(c.amountMinor);
    }
    return {
      days,
      totals: { redirects: redirects.reduce((n, g) => n + g._count._all, 0), orders: conversions.length, matched: matched.length },
      rows: [...byKey.values()].sort((a, b) => b.orders - a.orders || b.redirects - a.redirects),
      recent: conversions.slice(0, 20).map((c) => {
        const r = c.redirectId ? rmap.get(c.redirectId) : undefined;
        return {
          id: c.id,
          external_order_id: c.externalOrderId,
          amount_minor: c.amountMinor === null ? null : Number(c.amountMinor),
          currency: c.currency,
          received_at: c.receivedAt,
          matched: Boolean(c.redirectId),
          channel: r?.channel ?? null,
          store_id: r?.storeId ?? null,
          product_id: r?.productId ?? null,
        };
      }),
    };
  }
}
