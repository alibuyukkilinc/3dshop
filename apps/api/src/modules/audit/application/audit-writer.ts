import { Injectable } from '@nestjs/common';
import { type Actor, uuidv7 } from '@dtd/contracts';
import type { Tx } from '../../../infra/db/types.js';
import { type ChainFields, GENESIS_HASH, chainHash } from '../domain/chain.js';

export interface AuditEntry {
  actor: Actor;
  /** <modül>.<varlık>.<eylem>, örn. identity.admin.login */
  action: string;
  entity?: { type: string; id: string } | null;
  changesetId?: string | null;
  diff?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
  ipHash?: string | null;
}

/** Zincir kilidi: tüm denetim yazımları tek sıraya girer (pg_advisory_xact_lock, transaction sonunda bırakılır). */
const CHAIN_LOCK_KEY = 74_700_047;

/**
 * Denetim kaydı yazar (K47). Çağıranın transaction'ında çalışır: iş verisi geri alınırsa kayıt da yoktur.
 * Yalnız ekler; tablo UPDATE/DELETE'i tetikleyiciyle reddeder.
 */
@Injectable()
export class AuditWriter {
  async write(tx: Tx, entry: AuditEntry): Promise<{ id: string; hash: string }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY}::bigint)`;
    const last = await tx.$queryRaw<{ hash: string }[]>`
      SELECT hash FROM audit.audit_log ORDER BY seq DESC LIMIT 1`;
    const prevHash = last[0]?.hash ?? GENESIS_HASH;
    const [{ seq }] = (await tx.$queryRaw<{ seq: bigint }[]>`
      SELECT nextval('audit.audit_log_seq') AS seq`) as [{ seq: bigint }];

    const at = new Date();
    const fields: ChainFields = {
      id: uuidv7(at.getTime()),
      at: at.toISOString(),
      seq: seq.toString(),
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      action: entry.action,
      entityType: entry.entity?.type ?? null,
      entityId: entry.entity?.id ?? null,
      changesetId: entry.changesetId ?? null,
      diff: entry.diff ?? null,
      reason: entry.reason ?? null,
      requestId: entry.requestId ?? null,
      ipHash: entry.ipHash ?? null,
    };
    const hash = chainHash(prevHash, fields);
    await tx.auditLog.create({
      data: {
        id: fields.id,
        at,
        seq,
        actorType: fields.actorType,
        actorId: fields.actorId,
        action: fields.action,
        entityType: fields.entityType,
        entityId: fields.entityId,
        changesetId: fields.changesetId,
        diff: (fields.diff ?? undefined) as never,
        reason: fields.reason,
        requestId: fields.requestId,
        ipHash: fields.ipHash,
        prevHash,
        hash,
      },
    });
    return { id: fields.id, hash };
  }
}
