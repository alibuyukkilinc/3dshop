import { Injectable } from '@nestjs/common';
import { type AnalyticsBatch, AnalyticsBatchSchema, uuidv7 } from '@dtd/contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';

/** Ham olay saklama süresi (K37): 13 ay; sonra aylık bölüm silinir, günlük özet kalır. */
export const EVENT_RETENTION_MONTHS = 13;
/** Günlük özetin gün sınırı: kullanıcıların saat dilimi (pilot Türkiye). */
const TZ = 'Europe/Istanbul';
/** Özetin ürün/mağaza/terim kırılımı tuttuğu olaylar ve kırılım ifadesi */
const SUBJECT_SQL = `CASE name
  WHEN 'product_view' THEN product_id::text
  WHEN 'outbound_click' THEN product_id::text
  WHEN 'store_enter' THEN store_id::text
  WHEN 'search' THEN props->>'q'
  WHEN 'region_enter' THEN props->>'region'
END`;

export interface ParsedBatch {
  sessionId: string;
  events: { name: string; props: Record<string, unknown> }[];
}

/**
 * Platform olayları (K15, K37). İstemci yalnız rıza verilince gönderir (KVKK, varsayılan red). Olay zamanı
 * sunucu saatidir (istemci saati güvenilmez). Kişisel veri yazılmaz: sözlük şeması bilinmeyen alanları atar.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  parse(body: unknown): ParsedBatch | { error: string } {
    const r = AnalyticsBatchSchema.safeParse(body as AnalyticsBatch);
    if (!r.success) return { error: r.error.issues[0]?.message ?? 'geçersiz' };
    return { sessionId: r.data.session_id, events: r.data.events };
  }

  async ingest(batch: ParsedBatch, now = new Date()): Promise<number> {
    const rows = batch.events.map((e, i) => {
      const props = { ...e.props };
      // Arama terimi küçük harf (Türkçe) — aynı terim tek satırda sayılır
      if (e.name === 'search' && typeof props.q === 'string') props.q = props.q.toLocaleLowerCase('tr-TR');
      return {
        id: uuidv7(now.getTime()),
        // Aynı istekteki olaylar sırasını korusun
        occurredAt: new Date(now.getTime() + i),
        sessionId: batch.sessionId,
        name: e.name,
        storeId: typeof props.store_id === 'string' ? props.store_id : null,
        productId: typeof props.product_id === 'string' ? props.product_id : null,
        props: props as Prisma.InputJsonValue,
      };
    });
    await this.prisma.analyticsEvent.createMany({ data: rows });
    return rows.length;
  }

  /** Bu ayın ve gelecek ayın bölümü; saklama süresi dolan bölümler silinir. Silinen bölüm adları döner. */
  async maintainPartitions(now = new Date()): Promise<string[]> {
    await this.prisma.$queryRaw`SELECT analytics.ensure_events_partition(${now}::date)`;
    await this.prisma.$queryRaw`SELECT analytics.ensure_events_partition((${now}::date + interval '1 month')::date)`;
    const cut = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - EVENT_RETENTION_MONTHS, 1));
    const dropped = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT analytics.drop_events_partitions_before(${cut}::date) AS name`;
    return dropped.map((d) => d.name);
  }

  /** Bir günün özetini (İstanbul günü, YYYY-MM-DD) yeniden hesaplar: sil + ekle, tek transaction. */
  async summarizeDay(day: string): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('gün YYYY-MM-DD olmalı');
    const range = `occurred_at >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND occurred_at < (($1::date + 1)::timestamp AT TIME ZONE '${TZ}')`;
    await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`DELETE FROM analytics.event_daily WHERE day = $1::date`, day),
      this.prisma.$executeRawUnsafe(
        `INSERT INTO analytics.event_daily (day, name, subject, events, sessions)
         SELECT $1::date, name, '', count(*)::int, count(DISTINCT session_id)::int
           FROM analytics.events WHERE ${range} GROUP BY name
         UNION ALL
         SELECT $1::date, name, subject, count(*)::int, count(DISTINCT session_id)::int
           FROM (SELECT name, session_id, ${SUBJECT_SQL} AS subject FROM analytics.events WHERE ${range}) s
          WHERE subject IS NOT NULL AND subject <> '' GROUP BY name, subject`,
        day,
      ),
    ]);
  }

  /** Bugün ve dün (İstanbul): worker saatte bir çağırır; gün dönümünde dünün özeti kesinleşir. */
  async summarizeRecent(now = new Date()): Promise<void> {
    for (const offset of [1, 0]) await this.summarizeDay(istanbulDay(new Date(now.getTime() - offset * 86_400_000)));
  }

  /** Yönetim özeti: son N günün günlük özetinden (bugün dahil). */
  async summary(days: number) {
    const from = istanbulDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const rows = await this.prisma.analyticsEventDaily.findMany({ where: { day: { gte: new Date(`${from}T00:00:00Z`) } } });
    const totals = new Map<string, { name: string; events: number; sessions: number }>();
    const daily = new Map<string, Record<string, number>>();
    const top = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (r.subject === '') {
        const t = totals.get(r.name) ?? { name: r.name, events: 0, sessions: 0 };
        t.events += r.events;
        t.sessions += r.sessions;
        totals.set(r.name, t);
        const d = r.day.toISOString().slice(0, 10);
        const day = daily.get(d) ?? {};
        day[r.name] = (day[r.name] ?? 0) + r.events;
        daily.set(d, day);
      } else {
        const m = top.get(r.name) ?? new Map<string, number>();
        m.set(r.subject, (m.get(r.subject) ?? 0) + r.events);
        top.set(r.name, m);
      }
    }
    const topOf = (name: string, n = 10) =>
      [...(top.get(name) ?? new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([subject, events]) => ({ subject, events }));
    return {
      days,
      from,
      totals: [...totals.values()].sort((a, b) => b.events - a.events),
      daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({ day, counts })),
      top: {
        products: topOf('product_view'),
        stores: topOf('store_enter'),
        searches: topOf('search'),
        regions: topOf('region_enter'),
        outbound: topOf('outbound_click'),
      },
    };
  }
}

/** Tarihin İstanbul günü (YYYY-MM-DD). */
export function istanbulDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
