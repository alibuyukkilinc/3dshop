import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';
import { type AdminContext, conflict, notFound } from '../../../infra/http/admin-request.js';
import { AuditWriter } from '../../audit/public/index.js';
import { AdminUsersService } from '../../identity/public/index.js';
import { OutboxWriter, type PublishContext, type PublishItem, PublishableRegistry } from '../../platform/public/index.js';

export interface Preparer extends AdminContext {
  roles: string[];
}
export interface NewItem {
  entity_type: string;
  entity_id?: string | null;
  op: string;
  payload: Record<string, unknown>;
}

const invalid = (errors: string[]) =>
  new HttpException({ error: 'invalid_change', message: errors.join(' '), errors }, HttpStatus.UNPROCESSABLE_ENTITY);
const forbidden = (message: string) => new HttpException({ error: 'forbidden', message }, HttpStatus.FORBIDDEN);
const EDITABLE = new Set(['draft', 'rejected']);

/**
 * Değişiklik setleri (K44): taslak → inceleme → onay → (zamanlama) → yayın. Esnek dört göz: onaylayan
 * hazırlayandan farklı olmalı; başka aktif onaylayıcı yoksa hazırlayan gerekçe yazarak kendi onaylar
 * (self_approved, K13). Yayın tek transaction: her öğe bağdaştırıcıyla uygulanır, önceki durum saklanır,
 * canlı işaretçi güncellenir, olay yazılır. Her yayın geri alınabilir (yeni bir set olarak).
 */
@Injectable()
export class ChangesetsService {
  private readonly logger = new Logger('publishing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PublishableRegistry,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly admins: AdminUsersService,
  ) {}

  entityTypes() {
    return this.registry.list().map((a) => ({ entity_type: a.entityType, label: a.label, ops: a.ops }));
  }

  async list(status?: string) {
    const rows = await this.prisma.changeset.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { items: true } } },
    });
    return rows.map((c) => ({ ...summary(c), item_count: c._count.items }));
  }

  async get(id: string) {
    const c = await this.prisma.changeset.findUnique({
      where: { id },
      include: { items: { orderBy: { sort: 'asc' } }, approvals: { orderBy: { at: 'asc' } } },
    });
    if (!c) throw notFound('Değişiklik seti bulunamadı.');
    // Henüz yayınlanmamış öğelerde "şimdiki canlı durum" gösterilir (fark ekranı)
    const items = await Promise.all(
      c.items.map(async (i) => {
        const adapter = this.registry.get(i.entityType);
        const current =
          c.status !== 'published' && i.entityId && adapter
            ? await this.prisma.$transaction((tx) => adapter.snapshot(tx, i.entityId!))
            : null;
        return {
          id: i.id,
          entity_type: i.entityType,
          label: adapter?.label ?? i.entityType,
          entity_id: i.entityId,
          op: i.op,
          payload: i.payload,
          before: c.status === 'published' ? i.before : current,
        };
      }),
    );
    return {
      ...summary(c),
      items,
      approvals: c.approvals.map((a) => ({ approver_id: a.approverId, decision: a.decision, comment: a.comment, at: a.at })),
    };
  }

  async create(input: { title: string; description?: string; items?: NewItem[] }, by: Preparer) {
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.changeset.create({ data: { id, title: input.title.trim(), description: input.description?.trim() || null, createdBy: by.actor.id } });
      for (const [i, item] of (input.items ?? []).entries()) await this.addItemTx(tx, id, item, by, i);
      await this.audit.write(tx, {
        actor: by.actor,
        action: 'publishing.changeset.created',
        entity: { type: 'changeset', id },
        changesetId: id,
        diff: { title: input.title, items: input.items?.length ?? 0 },
        requestId: by.requestId,
        ipHash: by.ipHash,
      });
    });
    return this.get(id);
  }

  async addItem(changesetId: string, item: NewItem, by: Preparer) {
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, changesetId);
      if (!EDITABLE.has(c.status)) throw conflict('Yalnız taslak ya da reddedilmiş set düzenlenir.');
      const n = await tx.changesetItem.count({ where: { changesetId } });
      await this.addItemTx(tx, changesetId, item, by, n);
    });
    return this.get(changesetId);
  }

  async removeItem(changesetId: string, itemId: string) {
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, changesetId);
      if (!EDITABLE.has(c.status)) throw conflict('Yalnız taslak ya da reddedilmiş set düzenlenir.');
      const r = await tx.changesetItem.deleteMany({ where: { id: itemId, changesetId } });
      if (r.count === 0) throw notFound('Öğe bulunamadı.');
    });
    return this.get(changesetId);
  }

  async submit(id: string, by: Preparer) {
    return this.transition(id, by, ['draft', 'rejected'], 'in_review', 'publishing.changeset.submitted', async (tx, c) => {
      const items = await tx.changesetItem.findMany({ where: { changesetId: id } });
      if (items.length === 0) throw conflict('Boş set incelemeye gönderilemez.');
      const creator = await this.creatorRoles(c.createdBy, by);
      for (const i of items) await this.validateItem(tx, toItem(i), { actor: by.actor, changesetId: id, preparerRoles: creator });
      return { submittedAt: new Date() };
    });
  }

  async approve(id: string, input: { comment?: string; self_approval_reason?: string }, by: Preparer) {
    if (!by.roles.includes('approver')) throw forbidden('Onay için onaylayıcı rolü gerekir.');
    return this.transition(id, by, ['in_review'], 'approved', 'publishing.changeset.approved', async (tx, c) => {
      let self = false;
      if (c.createdBy === by.actor.id) {
        // Esnek dört göz: başka aktif onaylayıcı varsa kendi onayı yok
        const others = (await this.admins.activeApproverIds()).filter((x) => x !== by.actor.id);
        if (others.length > 0) throw forbidden('Kendi hazırladığınız seti başka bir onaylayıcı onaylamalı.');
        const reason = input.self_approval_reason?.trim() ?? '';
        if (reason.length < 10) throw conflict('Başka onaylayıcı olmadığı için kendi onayınızın gerekçesini yazın (en az 10 karakter).');
        self = true;
      }
      await tx.approval.create({
        data: { id: uuidv7(), changesetId: id, approverId: by.actor.id, decision: 'approve', comment: input.comment ?? null, at: new Date() },
      });
      return {
        approvedBy: by.actor.id,
        approvedAt: new Date(),
        selfApproved: self,
        selfApprovalReason: self ? input.self_approval_reason!.trim() : null,
      };
    });
  }

  async reject(id: string, input: { comment: string }, by: Preparer) {
    if (!by.roles.includes('approver')) throw forbidden('Reddetmek için onaylayıcı rolü gerekir.');
    return this.transition(id, by, ['in_review'], 'rejected', 'publishing.changeset.rejected', async (tx) => {
      await tx.approval.create({
        data: { id: uuidv7(), changesetId: id, approverId: by.actor.id, decision: 'reject', comment: input.comment, at: new Date() },
      });
      return {};
    });
  }

  async cancel(id: string, by: Preparer) {
    return this.transition(id, by, ['draft', 'in_review', 'approved', 'scheduled', 'rejected'], 'cancelled', 'publishing.changeset.cancelled', async () => ({}));
  }

  /** Onaylı seti hemen yayınlar ya da zamanlar. */
  async publish(id: string, input: { scheduled_at?: string | null }, by: Preparer) {
    if (input.scheduled_at) {
      const at = new Date(input.scheduled_at);
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000) throw conflict('Zamanlama en az 1 dakika ileride olmalı.');
      return this.transition(id, by, ['approved'], 'scheduled', 'publishing.changeset.scheduled', async () => ({ scheduledAt: at }));
    }
    await this.publishNow(id, by);
    return this.get(id);
  }

  /** Zamanı gelmiş setleri yayınlar (worker). */
  async publishDue(now = new Date()): Promise<number> {
    const due = await this.prisma.changeset.findMany({ where: { status: 'scheduled', scheduledAt: { lte: now } }, select: { id: true, approvedBy: true } });
    for (const c of due) {
      try {
        await this.publishNow(c.id, { actor: { type: 'admin', id: c.approvedBy! }, roles: [], requestId: null, ipHash: null }, true);
      } catch (e) {
        const message = (e as Error).message;
        this.logger.error(`Zamanlanmış yayın başarısız: ${c.id} — ${message}`);
        await this.prisma.changeset.update({ where: { id: c.id }, data: { lastError: message.slice(0, 500), status: 'approved', scheduledAt: null } });
      }
    }
    return due.length;
  }

  private async publishNow(id: string, by: Preparer, scheduled = false) {
    await this.prisma.$transaction(
      async (tx) => {
        const c = await this.lock(tx, id);
        if (c.status !== (scheduled ? 'scheduled' : 'approved')) throw conflict('Yalnız onaylı set yayınlanır.');
        const ctx: PublishContext = { actor: by.actor, changesetId: id, preparerRoles: await this.creatorRoles(c.createdBy, by) };
        const items = await tx.changesetItem.findMany({ where: { changesetId: id }, orderBy: { sort: 'asc' } });
        const now = new Date();
        const touched = new Set<string>();
        for (const row of items) {
          const item = toItem(row);
          const adapter = this.registry.get(item.entityType)!;
          await this.validateItem(tx, item, ctx);
          const before = item.entityId ? await adapter.snapshot(tx, item.entityId) : null;
          const { entityId } = await adapter.apply(tx, item, ctx);
          touched.add(adapter.entityType);
          await tx.changesetItem.update({
            where: { id: row.id },
            data: { entityId, before: before === null ? Prisma.DbNull : (before as Prisma.InputJsonValue) },
          });
          await tx.publication.upsert({
            where: { entityType_entityId: { entityType: item.entityType, entityId } },
            create: { entityType: item.entityType, entityId, changesetId: id, publishedAt: now },
            update: { changesetId: id, publishedAt: now },
          });
          await tx.publicationHistory.create({
            data: {
              id: uuidv7(),
              entityType: item.entityType,
              entityId,
              changesetId: id,
              action: c.rollbackOfId ? 'rollback' : 'publish',
              at: now,
              by: by.actor.id,
            },
          });
        }
        for (const t of touched) await this.registry.get(t)!.afterPublish?.(tx, ctx);
        await tx.changeset.update({
          where: { id },
          data: { status: 'published', publishedAt: now, publishedBy: by.actor.id, lastError: null, version: { increment: 1 } },
        });
        if (c.rollbackOfId) await tx.changeset.update({ where: { id: c.rollbackOfId }, data: { rolledBackById: id } });
        await this.audit.write(tx, {
          actor: by.actor,
          action: 'publishing.changeset.published',
          entity: { type: 'changeset', id },
          changesetId: id,
          diff: { items: items.length, scheduled, self_approved: c.selfApproved, rollback_of: c.rollbackOfId },
          requestId: by.requestId,
          ipHash: by.ipHash,
        });
        await this.outbox.append(tx, {
          type: 'publishing.changeset.published',
          sourceModule: 'publishing',
          aggregate: { type: 'changeset', id },
          actor: by.actor,
          data: { changeset_id: id, entity_types: [...touched], rollback_of: c.rollbackOfId },
        });
      },
      { timeout: 60_000 },
    );
  }

  /** Yayınlanmış setin tersini içeren yeni bir taslak set açar (K13: her yayın geri alınabilir). */
  async rollback(id: string, by: Preparer) {
    const c = await this.prisma.changeset.findUnique({ where: { id }, include: { items: { orderBy: { sort: 'desc' } } } });
    if (!c) throw notFound('Değişiklik seti bulunamadı.');
    if (c.status !== 'published') throw conflict('Yalnız yayınlanmış set geri alınır.');
    if (c.rolledBackById) throw conflict('Bu set zaten geri alındı.');
    const items: NewItem[] = c.items.map((i) => {
      const adapter = this.registry.get(i.entityType)!;
      const inv = adapter.inverse(i.before as Record<string, unknown> | null, { ...toItem(i), entityId: i.entityId! });
      return { entity_type: inv.entityType, entity_id: inv.entityId, op: inv.op, payload: inv.payload };
    });
    const created = await this.create({ title: `Geri al: ${c.title}`, description: `${c.id} setinin geri alınması`, items }, by);
    await this.prisma.changeset.update({ where: { id: created.id }, data: { rollbackOfId: id } });
    return this.get(created.id);
  }

  // ---------------------------------------------------------------- yardımcılar

  private async addItemTx(tx: Tx, changesetId: string, item: NewItem, by: Preparer, sort: number) {
    const adapter = this.registry.get(item.entity_type);
    if (!adapter) throw invalid([`Yayınlanamayan tür: ${item.entity_type}`]);
    if (!adapter.ops.includes(item.op)) throw invalid([`${adapter.label} için geçersiz işlem: ${item.op}`]);
    const pi: PublishItem = { entityType: item.entity_type, entityId: item.entity_id ?? null, op: item.op, payload: item.payload };
    await this.validateItem(tx, pi, { actor: by.actor, changesetId, preparerRoles: by.roles });
    if (pi.entityId) {
      const clash = await tx.changesetItem.findFirst({
        where: {
          entityType: pi.entityType,
          entityId: pi.entityId,
          changeset: { status: { in: ['draft', 'in_review', 'approved', 'scheduled'] }, id: { not: changesetId } },
        },
        select: { changesetId: true },
      });
      if (clash) throw conflict(`Bu kayıt başka bir açık değişiklik setinde (${clash.changesetId.slice(-6)}).`);
    }
    await tx.changesetItem.create({
      data: { id: uuidv7(), changesetId, entityType: pi.entityType, entityId: pi.entityId, op: pi.op, payload: pi.payload as Prisma.InputJsonValue, sort },
    });
  }

  private async validateItem(tx: Tx, item: PublishItem, ctx: PublishContext) {
    const adapter = this.registry.get(item.entityType);
    if (!adapter) throw invalid([`Yayınlanamayan tür: ${item.entityType}`]);
    const errors = await adapter.validate(tx, item, ctx);
    if (errors.length) throw invalid(errors);
  }

  /** Hazırlayanın rolleri: hukuki engel gibi kısıtlar hazırlayana göre denetlenir (K44). */
  private async creatorRoles(createdBy: string, by: Preparer): Promise<string[]> {
    if (createdBy === by.actor.id && by.roles.length) return by.roles;
    return this.admins.rolesOf(createdBy);
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM publishing.changesets WHERE id = ${id}::uuid FOR UPDATE`;
    const c = await tx.changeset.findUnique({ where: { id } });
    if (!c) throw notFound('Değişiklik seti bulunamadı.');
    return c;
  }

  private async transition(
    id: string,
    by: Preparer,
    from: string[],
    to: string,
    action: string,
    work: (tx: Tx, c: Awaited<ReturnType<ChangesetsService['lock']>>) => Promise<Prisma.ChangesetUpdateInput>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (!from.includes(c.status)) throw conflict(`Bu işlem "${c.status}" durumundaki sete uygulanamaz.`);
      const extra = await work(tx, c);
      await tx.changeset.update({ where: { id }, data: { ...extra, status: to, version: { increment: 1 } } });
      await this.audit.write(tx, {
        actor: by.actor,
        action,
        entity: { type: 'changeset', id },
        changesetId: id,
        diff: { from: c.status, to, ...(extra.selfApproved ? { self_approved: true, reason: extra.selfApprovalReason } : {}) },
        requestId: by.requestId,
        ipHash: by.ipHash,
      });
    });
    return this.get(id);
  }
}

function toItem(i: { entityType: string; entityId: string | null; op: string; payload: unknown }): PublishItem {
  return { entityType: i.entityType, entityId: i.entityId, op: i.op, payload: i.payload as Record<string, unknown> };
}

function summary(c: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdBy: string;
  createdAt: Date;
  submittedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  selfApproved: boolean;
  selfApprovalReason: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  rollbackOfId: string | null;
  rolledBackById: string | null;
  lastError: string | null;
  version: number;
}) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    status: c.status,
    created_by: c.createdBy,
    created_at: c.createdAt,
    submitted_at: c.submittedAt,
    approved_by: c.approvedBy,
    approved_at: c.approvedAt,
    self_approved: c.selfApproved,
    self_approval_reason: c.selfApprovalReason,
    scheduled_at: c.scheduledAt,
    published_at: c.publishedAt,
    rollback_of_id: c.rollbackOfId,
    rolled_back_by_id: c.rolledBackById,
    last_error: c.lastError,
    version: c.version,
  };
}
