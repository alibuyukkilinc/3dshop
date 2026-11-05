import { Injectable, type OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import type { Tx } from '../../../infra/db/types.js';
import { OutboxWriter, type Publishable, type PublishContext, type PublishItem, PublishableRegistry } from '../../platform/public/index.js';
import { ConditionSchema } from '../domain/condition.js';
import { CHANNELS, LAYERS, TARGET_TYPES } from '../domain/evaluate.js';

export const RULESET_PUBLISHED = 'rules.ruleset.published';

/** Kural tanımı: changeset öğesinin payload'u ve snapshot biçimi. */
export const RuleDefinitionSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$/, 'Kod BÜYÜK_HARF_ALT_ÇİZGİ olmalı'),
    name: z.string().trim().min(3).max(200),
    layer: z.enum(LAYERS),
    effect: z.enum(['allow', 'deny', 'boost', 'demote']),
    effect_params: z.object({ factor: z.number().positive().max(100).optional() }).strict().default({}),
    condition: ConditionSchema.nullable().default(null),
    priority: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    overrides_rule_id: z.uuid().nullable().default(null),
    legal_ref: z.string().trim().max(300).nullable().default(null),
    reason: z.string().trim().max(1000).nullable().default(null),
    valid_from: z.iso.datetime({ offset: true }).nullable().default(null),
    valid_to: z.iso.datetime({ offset: true }).nullable().default(null),
    targets: z
      .array(z.object({ type: z.enum(TARGET_TYPES), id: z.uuid().nullable(), include: z.boolean().default(true) }).strict())
      .max(200)
      .default([]),
    channels: z.array(z.enum(CHANNELS)).max(7).default([]),
  })
  .strict();
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

/**
 * Kural yayını (K43, K44). Kurallar yalnız changeset ile canlıya çıkar; her yayın yeni kural seti sürümü ve
 * tam yeniden hesap (rules.ruleset.published). Hukuki/KVKK engelini yalnız platform_admin hazırlayabilir;
 * dayanağı zorunlu, etkisi yalnız gizlemek. Sistem kuralları buradan değiştirilemez.
 */
@Injectable()
export class RulePublishable implements Publishable, OnModuleInit {
  readonly entityType = 'rule';
  readonly label = 'Görünürlük kuralı';
  readonly ops = ['create', 'update', 'archive', 'activate'];

  constructor(
    private readonly registry: PublishableRegistry,
    private readonly outbox: OutboxWriter,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async validate(tx: Tx, item: PublishItem, ctx: PublishContext): Promise<string[]> {
    const existing = item.entityId ? await tx.rule.findUnique({ where: { id: item.entityId } }) : null;
    if (item.op !== 'create') {
      if (!existing) return ['Kural bulunamadı.'];
      if (existing.system) return ['Sistem kuralları değiştirilemez; aynı etkiyi istisna kuralıyla verin.'];
      if (existing.layer === 'mandatory_block' && !ctx.preparerRoles.includes('platform_admin')) {
        return ['Hukuki/KVKK engeline yalnız platform yöneticisi dokunabilir.'];
      }
    }
    if (item.op === 'archive' || item.op === 'activate') {
      if (item.op === 'archive' && existing!.layer === 'mandatory_block') {
        return ['Hukuki engel arşivlenemez; kaldırma kararı yeni dayanakla "update" olarak geçmeli.'];
      }
      return [];
    }
    if (item.op === 'create' && item.entityId) return ['Yeni kural için kimlik verilmez.'];
    const parsed = RuleDefinitionSchema.safeParse(item.payload);
    if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.') || 'kural'}: ${i.message}`);
    const d = parsed.data;
    const errors: string[] = [];
    if (d.layer === 'mandatory_block') {
      if (!ctx.preparerRoles.includes('platform_admin')) errors.push('Hukuki/KVKK engelini yalnız platform yöneticisi hazırlayabilir.');
      if (d.effect !== 'deny') errors.push('Hukuki engelin etkisi yalnız "gizle" olabilir.');
      if (!d.legal_ref) errors.push('Hukuki engel için dayanak (karar/dilekçe/KVKK talep no) zorunlu.');
    }
    if (d.overrides_rule_id) {
      if (d.layer !== 'exception') errors.push('Yalnız istisna kuralı başka bir kuralı ezebilir.');
      const target = await tx.rule.findUnique({ where: { id: d.overrides_rule_id } });
      if (!target) errors.push('Ezilen kural bulunamadı.');
      else if (target.layer === 'mandatory_block') errors.push('Hukuki/KVKK engeli istisnayla ezilemez.');
    }
    if ((d.effect === 'boost' || d.effect === 'demote') && !d.effect_params.factor) errors.push('Öne çıkarma/geri itme için katsayı gerekir.');
    if (d.valid_from && d.valid_to && d.valid_from >= d.valid_to) errors.push('Geçerlilik bitişi başlangıçtan sonra olmalı.');
    const clash = await tx.rule.findFirst({ where: { code: d.code, ...(item.entityId && { id: { not: item.entityId } }) } });
    if (clash) errors.push(`"${d.code}" kodu kullanılıyor.`);
    return errors;
  }

  async snapshot(tx: Tx, entityId: string): Promise<Record<string, unknown> | null> {
    const r = await tx.rule.findUnique({ where: { id: entityId }, include: { targets: true, channels: true } });
    if (!r) return null;
    const def: RuleDefinition = {
      code: r.code,
      name: r.name,
      layer: r.layer as RuleDefinition['layer'],
      effect: r.effect as RuleDefinition['effect'],
      effect_params: r.effectParams as RuleDefinition['effect_params'],
      condition: r.condition as RuleDefinition['condition'],
      priority: r.priority,
      overrides_rule_id: r.overridesRuleId,
      legal_ref: r.legalRef,
      reason: r.reason,
      valid_from: r.validFrom?.toISOString() ?? null,
      valid_to: r.validTo?.toISOString() ?? null,
      targets: r.targets.map((t) => ({ type: t.targetType as RuleDefinition['targets'][number]['type'], id: t.targetId, include: t.include })),
      channels: r.channels.map((c) => c.channel as RuleDefinition['channels'][number]),
    };
    return { ...def, status: r.status };
  }

  async apply(tx: Tx, item: PublishItem, ctx: PublishContext) {
    if (item.op === 'archive' || item.op === 'activate') {
      await tx.rule.update({
        where: { id: item.entityId! },
        data: { status: item.op === 'archive' ? 'archived' : 'active', version: { increment: 1 } },
      });
      return { entityId: item.entityId! };
    }
    const d = RuleDefinitionSchema.parse(item.payload);
    const id = item.entityId ?? uuidv7();
    const fields = {
      code: d.code,
      name: d.name,
      layer: d.layer,
      effect: d.effect,
      effectParams: d.effect_params as Prisma.InputJsonValue,
      condition: d.condition === null ? Prisma.DbNull : (d.condition as Prisma.InputJsonValue),
      priority: d.priority,
      overridesRuleId: d.overrides_rule_id,
      legalRef: d.legal_ref,
      reason: d.reason,
      validFrom: d.valid_from ? new Date(d.valid_from) : null,
      validTo: d.valid_to ? new Date(d.valid_to) : null,
      status: 'active',
    };
    if (item.op === 'create') {
      await tx.rule.create({ data: { id, ...fields, createdBy: ctx.actor.id } });
    } else {
      await tx.rule.update({ where: { id }, data: { ...fields, version: { increment: 1 } } });
      await tx.ruleTarget.deleteMany({ where: { ruleId: id } });
      await tx.ruleChannel.deleteMany({ where: { ruleId: id } });
    }
    if (d.targets.length) {
      await tx.ruleTarget.createMany({ data: d.targets.map((t) => ({ id: uuidv7(), ruleId: id, targetType: t.type, targetId: t.id, include: t.include })) });
    }
    if (d.channels.length) await tx.ruleChannel.createMany({ data: [...new Set(d.channels)].map((channel) => ({ ruleId: id, channel })) });
    return { entityId: id };
  }

  inverse(before: Record<string, unknown> | null, item: PublishItem & { entityId: string }): PublishItem {
    const base = { entityType: 'rule', entityId: item.entityId };
    if (item.op === 'create' || before === null) return { ...base, op: 'archive', payload: {} };
    if (item.op === 'archive') return { ...base, op: 'activate', payload: {} };
    if (item.op === 'activate') return { ...base, op: 'archive', payload: {} };
    // snapshot'taki status kural tanımının parçası değil; geri alma yalnız tanımı geri yazar
    const def = Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'status'));
    return { ...base, op: 'update', payload: def };
  }

  /** Kural seti sürümü artar ve tam yeniden hesap istenir (worker'daki görünürlük tüketicisi). */
  async afterPublish(tx: Tx, ctx: PublishContext) {
    const last = await tx.rulesetVersion.aggregate({ _max: { number: true } });
    const number = (last._max.number ?? 0) + 1;
    await tx.rulesetVersion.create({ data: { number, changesetId: ctx.changesetId, note: 'yayın' } });
    await this.outbox.append(tx, {
      type: RULESET_PUBLISHED,
      sourceModule: 'rules',
      aggregate: { type: 'ruleset', id: String(number) },
      actor: ctx.actor,
      causationId: ctx.changesetId,
      data: { ruleset_version: number, changeset_id: ctx.changesetId },
    });
  }
}
