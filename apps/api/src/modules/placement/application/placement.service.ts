import { Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { CatalogQuery, type ProductSort } from '../../catalog/public/index.js';
import { OutboxWriter, SettingsService } from '../../platform/public/index.js';
import { VisibilityService } from '../../rules/public/index.js';
import { ScenesService } from '../../scene/public/index.js';
import { type Placed, type SourceIn, type V3, fillSlots, inWindow, nearestStore } from '../domain/fill.js';

export const PLACEMENT_DIRTY = 'placement.dirty';
export const LIVE_CHANGED = 'placement.live.changed';
const CHANNEL = '3d' as const;
/** Çalıştırma sonuçları: son N çalıştırma saklanır (teşhis) */
const KEEP_RUNS = 50;

interface SceneNode {
  id: string;
  transform: { p: V3 };
  components: { type: string; [k: string]: unknown }[];
}

/**
 * Yerleşim motoru (A5, K23). Yuvalar yayındaki bölge sahnelerinden eşitlenir; kurallar ve pinler changeset ile
 * yayınlanır (K44). Çalıştırma otomatiktir: onaylı girdilerden çıkan sonuç canlıya geçer, değişirse
 * placement.live.changed yazılır ve bölge paketleri yeniden derlenir (K48).
 */
@Injectable()
export class PlacementService {
  private readonly logger = new Logger('placement');

  constructor(
    private readonly prisma: PrismaService,
    private readonly scenes: ScenesService,
    private readonly visibility: VisibilityService,
    private readonly catalog: CatalogQuery,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxWriter,
  ) {}

  async markDirty(): Promise<void> {
    await this.settings.set(PLACEMENT_DIRTY, { at: new Date().toISOString() });
  }

  async runIfDirty(): Promise<boolean> {
    const dirty = await this.settings.get<{ at: string } | null>(PLACEMENT_DIRTY, null);
    if (!dirty) return false;
    await this.settings.set(PLACEMENT_DIRTY, null);
    try {
      await this.run('event');
      return true;
    } catch (e) {
      await this.settings.set(PLACEMENT_DIRTY, dirty);
      throw e;
    }
  }

  /** Yayındaki bölge sahnelerinden yuvaları eşitler; sahneden kalkanlar orphaned olur (pinleri korunur). */
  async syncSlots(): Promise<{ active: number; orphaned: number }> {
    const seen = new Set<string>();
    for (const s of await this.scenes.list()) {
      if (s.owner_type !== 'region' || !s.live_version_id) continue;
      const live = await this.scenes.live(s.id);
      const nodes = ((live?.document as { nodes?: SceneNode[] } | undefined)?.nodes ?? []) as SceneNode[];
      const entrances = nodes
        .map((n) => ({ n, a: n.components.find((c) => c.type === 'anchor' && c.kind === 'store_entrance') }))
        .filter((e) => e.a)
        .map((e) => ({ id: e.a!.ref_id as string, entrance: e.n.transform.p }));
      const slots = nodes
        .map((n) => ({ n, c: n.components.find((c) => c.type === 'slot') }))
        .filter((x) => x.c)
        .map((x) => ({ node: x.n, key: x.c!.slot_id as string, store: nearestStore(x.n.transform.p, entrances) }));
      // Sıra: aynı mağazanın yuvaları soldan sağa (x), eşitse önden arkaya (z)
      slots.sort((a, b) => a.node.transform.p[0] - b.node.transform.p[0] || a.node.transform.p[2] - b.node.transform.p[2]);
      const ordinal = new Map<string, number>();
      for (const sl of slots) {
        const k = sl.store ?? '-';
        const o = ordinal.get(k) ?? 0;
        ordinal.set(k, o + 1);
        const data = { ownerId: s.owner_id, nodeId: sl.node.id, storeId: sl.store, ordinal: o, x: sl.node.transform.p[0], z: sl.node.transform.p[2], status: 'active' };
        const row = await this.prisma.placementSlot.upsert({
          where: { sceneId_slotKey: { sceneId: s.id, slotKey: sl.key } },
          create: { id: uuidv7(), sceneId: s.id, slotKey: sl.key, ...data },
          update: data,
          select: { id: true },
        });
        seen.add(row.id);
      }
    }
    const orphaned = await this.prisma.placementSlot.updateMany({ where: { id: { notIn: [...seen] }, status: 'active' }, data: { status: 'orphaned' } });
    if (orphaned.count) this.logger.warn(`${orphaned.count} yuva sahneden kalktı (orphaned)`);
    return { active: seen.size, orphaned: orphaned.count };
  }

  /** Tam çalıştırma: yuvaları eşitle, her mağazanın yuvalarını doldur, değiştiyse canlıya al. */
  async run(trigger: 'schedule' | 'event' | 'manual'): Promise<{ run_id: string; changed: boolean; placed: number }> {
    const runId = uuidv7();
    await this.prisma.placementRun.create({ data: { id: runId, trigger } });
    try {
      const sync = await this.syncSlots();
      const now = new Date();
      const [slots, pins, rules] = await Promise.all([
        this.prisma.placementSlot.findMany({ where: { status: 'active', storeId: { not: null } }, orderBy: [{ storeId: 'asc' }, { ordinal: 'asc' }] }),
        this.prisma.placementPin.findMany({ where: { status: 'active' } }),
        this.prisma.placementRule.findMany({ where: { status: 'active' }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] }),
      ]);
      const validPins = pins.filter((p) => inWindow(now, p.validFrom, p.validTo));
      const visiblePinned = await this.visibility.visibleIds('product', CHANNEL, [...new Set(validPins.map((p) => p.itemId))]);
      const validRules = rules.filter((r) => inWindow(now, r.validFrom, r.validTo));
      const byStore = new Map<string, typeof slots>();
      for (const s of slots) byStore.set(s.storeId!, [...(byStore.get(s.storeId!) ?? []), s]);
      const boosts = await this.visibility.boosts('product', CHANNEL);

      const placed: Placed[] = [];
      for (const [storeId, storeSlots] of byStore) {
        const capacity = storeSlots.reduce((n, s) => n + s.capacity, 0);
        const ids = await this.visibility.visibleProductIdsOfStore(storeId, CHANNEL);
        const list = async (q: { categoryId?: string; brandId?: string; inStock?: boolean; sort: ProductSort }) =>
          ids.length ? (await this.catalog.list({ productIds: ids, ...q, offset: 0, limit: capacity + validPins.length, boosts })).items.map((i) => i.id) : [];
        const sources: SourceIn[] = [];
        for (const r of validRules.filter((r) => !r.storeId || r.storeId === storeId)) {
          sources.push({
            kind: 'rule',
            ruleId: r.id,
            limitPerSlot: r.limitPerSlot,
            items: await list({ categoryId: r.categoryId ?? undefined, brandId: r.brandId ?? undefined, inStock: r.inStock || undefined, sort: r.sortBy as ProductSort }),
          });
        }
        sources.push({ kind: 'default', ruleId: null, limitPerSlot: Number.MAX_SAFE_INTEGER, items: await list({ sort: 'relevance' }) });
        const slotIds = new Set(storeSlots.map((s) => s.id));
        const storePins = validPins.filter((p) => slotIds.has(p.slotId) && visiblePinned.has(p.itemId));
        placed.push(...fillSlots(storeSlots, storePins, sources));
      }

      const changed = await this.prisma.$transaction(async (tx) => {
        await tx.placementResult.createMany({ data: placed.map((p) => ({ runId, slotId: p.slotId, position: p.position, itemType: 'product', itemId: p.itemId, source: p.source, ruleId: p.ruleId })) });
        const current = await tx.placementLive.findMany();
        const key = (p: { slotId: string; position: number; itemId: string; source: string }) => `${p.slotId}:${p.position}:${p.itemId}:${p.source}`;
        const before = new Set(current.map(key));
        const same = before.size === placed.length && placed.every((p) => before.has(key(p)));
        if (same) return false;
        await tx.placementLive.deleteMany({});
        await tx.placementLive.createMany({ data: placed.map((p) => ({ slotId: p.slotId, position: p.position, itemType: 'product', itemId: p.itemId, source: p.source, ruleId: p.ruleId, runId })) });
        await this.outbox.append(tx, {
          type: LIVE_CHANGED,
          sourceModule: 'placement',
          aggregate: { type: 'placement_run', id: runId },
          actor: { type: 'system', id: 'placement' },
          data: { run_id: runId, placed: placed.length, previous: current.length },
        });
        return true;
      });

      const stats = {
        slots: slots.length,
        stores: byStore.size,
        placed: placed.length,
        by_source: { pin: placed.filter((p) => p.source === 'pin').length, rule: placed.filter((p) => p.source === 'rule').length, default: placed.filter((p) => p.source === 'default').length },
        orphaned_slots: sync.orphaned,
        changed,
      };
      await this.prisma.placementRun.update({ where: { id: runId }, data: { status: 'succeeded', finishedAt: new Date(), stats } });
      await this.prune();
      return { run_id: runId, changed, placed: placed.length };
    } catch (e) {
      await this.prisma.placementRun.update({ where: { id: runId }, data: { status: 'failed', finishedAt: new Date(), error: (e as Error).message.slice(0, 2000) } });
      throw e;
    }
  }

  private async prune() {
    const old = await this.prisma.placementRun.findMany({ orderBy: { startedAt: 'desc' }, skip: KEEP_RUNS, select: { id: true } });
    if (old.length) await this.prisma.placementResult.deleteMany({ where: { runId: { in: old.map((r) => r.id) } } });
  }

  /** Bölge paketi için (K48): sahnenin yuva anahtarı → yayındaki ürünler (sıralı) ve mağaza. */
  async liveForScene(sceneId: string): Promise<Map<string, { storeId: string | null; items: string[] }>> {
    const slots = await this.prisma.placementSlot.findMany({ where: { sceneId, status: 'active' }, select: { id: true, slotKey: true, storeId: true } });
    const live = await this.prisma.placementLive.findMany({ where: { slotId: { in: slots.map((s) => s.id) } }, orderBy: { position: 'asc' } });
    return new Map(slots.map((s) => [s.slotKey, { storeId: s.storeId, items: live.filter((l) => l.slotId === s.id).map((l) => l.itemId) }]));
  }

  /** Yönetim: yuvalar, yayındaki öğe ve pinleri. */
  async slots() {
    const [slots, live, pins] = await Promise.all([
      this.prisma.placementSlot.findMany({ orderBy: [{ status: 'asc' }, { storeId: 'asc' }, { ordinal: 'asc' }] }),
      this.prisma.placementLive.findMany(),
      this.prisma.placementPin.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const names = new Map((await this.catalog.names([...new Set([...live.map((l) => l.itemId), ...pins.map((p) => p.itemId)])])).map((n) => [n.id, n.name]));
    return slots.map((s) => ({
      id: s.id,
      scene_id: s.sceneId,
      region_id: s.ownerId,
      slot_key: s.slotKey,
      kind: s.kind,
      store_id: s.storeId,
      capacity: s.capacity,
      status: s.status,
      live: live
        .filter((l) => l.slotId === s.id)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ position: l.position, product_id: l.itemId, name: names.get(l.itemId) ?? null, source: l.source, rule_id: l.ruleId })),
      pins: pins
        .filter((p) => p.slotId === s.id)
        .map((p) => ({ id: p.id, position: p.position, product_id: p.itemId, name: names.get(p.itemId) ?? null, locked: p.locked, valid_from: p.validFrom, valid_to: p.validTo, reason: p.reason })),
    }));
  }

  async rules() {
    return (await this.prisma.placementRule.findMany({ orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }] })).map((r) => ({
      id: r.id,
      name: r.name,
      store_id: r.storeId,
      category_id: r.categoryId,
      brand_id: r.brandId,
      in_stock: r.inStock,
      sort_by: r.sortBy,
      limit_per_slot: r.limitPerSlot,
      priority: r.priority,
      status: r.status,
      valid_from: r.validFrom,
      valid_to: r.validTo,
      version: r.version,
    }));
  }

  async runs(limit = 20) {
    return (await this.prisma.placementRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit })).map((r) => ({
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      stats: r.stats,
      error: r.error,
    }));
  }
}
