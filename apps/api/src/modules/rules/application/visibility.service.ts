import { Injectable, Logger } from '@nestjs/common';
import { SYSTEM_ACTOR, uuidv7 } from '@dtd/contracts';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';
import { CatalogFacts } from '../../catalog/public/index.js';
import { CommerceFacts } from '../../commerce/public/index.js';
import { OutboxWriter } from '../../platform/public/index.js';
import type { Condition } from '../domain/condition.js';
import { CHANNELS, type Channel, type Decision, type RuleDef, type Subject, evaluate } from '../domain/evaluate.js';

export interface RecomputeScope {
  productIds?: string[];
  storeIds?: string[];
  sourceSiteIds?: string[];
  all?: boolean;
}

export const VISIBILITY_CHANGED = 'rules.visibility.changed';
const MAX_CHANGED_IN_EVENT = 500;

/**
 * Görünürlük hesabı (K43): kural seti + olgular → visibility_resolved (kanal × hedef). Okuma yolu (vitrin,
 * arama, bölge paketi) yalnız bu tabloya bakar. Sonuç değişen hedefler rules.visibility.changed olayıyla
 * duyurulur (K34). Hesap idempotenttir: aynı girdiyle tekrar çalışınca olay üretmez.
 */
@Injectable()
export class VisibilityService {
  private readonly logger = new Logger('rules.visibility');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogFacts,
    private readonly commerce: CommerceFacts,
    private readonly outbox: OutboxWriter,
  ) {}

  async activeRules(db: Tx | PrismaService = this.prisma): Promise<RuleDef[]> {
    const rows = await db.rule.findMany({ where: { status: 'active' }, include: { targets: true, channels: true } });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      layer: r.layer as RuleDef['layer'],
      effect: r.effect as RuleDef['effect'],
      params: r.effectParams as RuleDef['params'],
      condition: r.condition as Condition | null,
      priority: r.priority,
      targets: r.targets.map((t) => ({ type: t.targetType as RuleDef['targets'][number]['type'], id: t.targetId, include: t.include })),
      channels: r.channels.map((c) => c.channel as Channel),
      validFrom: r.validFrom,
      validTo: r.validTo,
    }));
  }

  async rulesetVersion(db: Tx | PrismaService = this.prisma): Promise<number> {
    const v = await db.rulesetVersion.aggregate({ _max: { number: true } });
    return v._max.number ?? 0;
  }

  /** Hedeflerin olgularını kurar: ürün kendi mağazasının durumunu da taşır. */
  async subjects(scope: RecomputeScope, db?: Tx): Promise<Subject[]> {
    const products = await this.catalog.products(
      scope.all ? {} : { productIds: scope.productIds, storeIds: scope.storeIds, sourceSiteIds: scope.sourceSiteIds },
      db,
    );
    const storeIds = scope.all ? undefined : [...new Set([...(scope.storeIds ?? []), ...products.map((p) => p.storeId)])];
    const stores = await this.commerce.stores(storeIds, db);
    const storeBy = new Map(stores.map((s) => [s.id, s]));
    const subjects: Subject[] = [];
    // Mağazalar yalnız açıkça istendiğinde ya da tam hesapta hedeftir; ürün olayı mağazayı yeniden hesaplamaz
    for (const s of scope.all || scope.storeIds ? stores.filter((x) => scope.all || scope.storeIds!.includes(x.id)) : []) {
      subjects.push({ type: 'store', id: s.id, refs: { company: [s.companyId] }, facts: { 'store.status': s.status, 'company.id': s.companyId } });
    }
    for (const p of products) {
      const store = storeBy.get(p.storeId);
      subjects.push({
        type: 'product',
        id: p.id,
        refs: {
          store: [p.storeId],
          ...(store && { company: [store.companyId] }),
          ...(p.brandId && { brand: [p.brandId] }),
          category: p.categoryIds,
        },
        facts: { ...p.facts, 'store.status': store?.status ?? 'missing', 'store.id': p.storeId },
      });
    }
    return subjects;
  }

  /**
   * Kapsamdaki hedefleri yeniden hesaplar. tx verilirse (olay tüketicisi) onun içinde; verilmezse kendi
   * transaction'ında. Döner: değişen (görünürlüğü dönen) hedef sayısı.
   */
  async recompute(scope: RecomputeScope, tx?: Tx, now = new Date()): Promise<{ targets: number; changed: number }> {
    const run = async (db: Tx) => {
      const [rules, version, subjects] = await Promise.all([this.activeRules(db), this.rulesetVersion(db), this.subjects(scope, db)]);
      if (subjects.length === 0) return { targets: 0, changed: 0 };
      const ids = subjects.map((s) => s.id);
      const previous = await db.visibilityResolved.findMany({
        where: { targetId: { in: ids } },
        select: { targetType: true, targetId: true, channel: true, visible: true },
      });
      const prevBy = new Map(previous.map((r) => [`${r.targetType}:${r.targetId}:${r.channel}`, r.visible]));
      const rows: Prisma.VisibilityResolvedCreateManyInput[] = [];
      const changed: { target_type: string; target_id: string; channel: string; visible: boolean }[] = [];
      for (const s of subjects) {
        for (const channel of CHANNELS) {
          const d = evaluate(rules, s, channel, now);
          rows.push(toRow(s, channel, d, version, now));
          const before = prevBy.get(`${s.type}:${s.id}:${channel}`);
          if (before === undefined || before !== d.visible) {
            changed.push({ target_type: s.type, target_id: s.id, channel, visible: d.visible });
          }
        }
      }
      await db.visibilityResolved.deleteMany({ where: { targetId: { in: ids } } });
      for (let i = 0; i < rows.length; i += 2_000) await db.visibilityResolved.createMany({ data: rows.slice(i, i + 2_000) });
      if (changed.length) {
        await this.outbox.append(db, {
          type: VISIBILITY_CHANGED,
          sourceModule: 'rules',
          aggregate: { type: 'visibility_batch', id: uuidv7() },
          actor: SYSTEM_ACTOR,
          data: {
            ruleset_version: version,
            changed_count: changed.length,
            changed: changed.slice(0, MAX_CHANGED_IN_EVENT),
            truncated: changed.length > MAX_CHANGED_IN_EVENT,
          },
        });
      }
      return { targets: subjects.length, changed: changed.length };
    };
    const result = tx ? await run(tx) : await this.prisma.$transaction(run, { timeout: 120_000 });
    if (scope.all) this.logger.log(`Tam hesap: ${result.targets} hedef, ${result.changed} değişiklik`);
    return result;
  }

  /** "Neden görünmüyor?" (K43): canlı değerlendirme + kayıtlı sonuç; ikisi farklıysa hesap bekliyor demektir. */
  async explain(targetType: 'product' | 'store', targetId: string, channel: Channel, now = new Date()) {
    const scope = targetType === 'product' ? { productIds: [targetId] } : { storeIds: [targetId] };
    const subject = (await this.subjects(scope)).find((s) => s.type === targetType && s.id === targetId);
    if (!subject) return null;
    const rules = await this.activeRules();
    const decision = evaluate(rules, subject, channel, now);
    const stored = await this.prisma.visibilityResolved.findUnique({
      where: { targetType_targetId_channel: { targetType, targetId, channel } },
    });
    const names = new Map((await this.prisma.rule.findMany({ select: { code: true, name: true, reason: true, legalRef: true } })).map((r) => [r.code, r]));
    return {
      target: { type: targetType, id: targetId },
      channel,
      visible: decision.visible,
      boost: decision.boost,
      layer: decision.layer,
      decided_by: decision.decidedByCode ? { code: decision.decidedByCode, ...pick(names.get(decision.decidedByCode)) } : null,
      steps: decision.steps.map((s) => ({ ...s, name: names.get(s.rule)?.name ?? s.rule })),
      facts: subject.facts,
      stored: stored ? { visible: stored.visible, computed_at: stored.computedAt, ruleset_version: stored.rulesetVersion } : null,
      in_sync: stored?.visible === decision.visible,
    };
  }

  /** Görünür hedeflerin sıralama katsayısı (boost ≠ 1 olanlar). */
  async boosts(targetType: 'product' | 'store', channel: Channel): Promise<Map<string, number>> {
    const rows = await this.prisma.visibilityResolved.findMany({
      where: { targetType, channel, visible: true, NOT: { boost: 1 } },
      select: { targetId: true, boost: true },
    });
    return new Map(rows.map((r) => [r.targetId, Number(r.boost)]));
  }

  /** Bir mağazanın kanalda görünen ürünleri: ürün olgusundaki mağaza kimliğinden (explanation değil, olgu tablosu yok). */
  async visibleProductIdsOfStore(storeId: string, channel: Channel): Promise<string[]> {
    const products = await this.catalog.products({ storeIds: [storeId] });
    const visible = await this.visibleIds('product', channel, products.map((p) => p.id));
    return products.filter((p) => visible.has(p.id)).map((p) => p.id);
  }

  async visibleProductCountsByStore(channel: Channel, storeIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const id of storeIds) out.set(id, (await this.visibleProductIdsOfStore(id, channel)).length);
    return out;
  }

  /** Bir kanalda görünen ürün kimlikleri (vitrin, arama). */
  async visibleIds(targetType: 'product' | 'store', channel: Channel, ids?: string[]): Promise<Set<string>> {
    const rows = await this.prisma.visibilityResolved.findMany({
      where: { targetType, channel, visible: true, ...(ids && { targetId: { in: ids } }) },
      select: { targetId: true },
    });
    return new Set(rows.map((r) => r.targetId));
  }
}

function toRow(s: Subject, channel: Channel, d: Decision, version: number, now: Date): Prisma.VisibilityResolvedCreateManyInput {
  return {
    targetType: s.type,
    targetId: s.id,
    channel,
    visible: d.visible,
    boost: new Prisma.Decimal(d.boost),
    layer: d.layer,
    decidedByRuleId: d.decidedBy,
    explanation: { decided_by: d.decidedByCode, steps: d.steps } as unknown as Prisma.InputJsonValue,
    rulesetVersion: version,
    computedAt: now,
  };
}

function pick(r: { name: string; reason: string | null; legalRef: string | null } | undefined) {
  return r ? { name: r.name, reason: r.reason, legal_ref: r.legalRef } : {};
}
