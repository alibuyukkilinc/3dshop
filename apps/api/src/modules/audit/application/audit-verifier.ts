import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { GENESIS_HASH, chainHash } from '../domain/chain.js';

export interface ChainCheck {
  checked: number;
  ok: boolean;
  /** Zincirin ilk kırıldığı satırın sırası */
  brokenAtSeq: string | null;
}

/** Gece işi: zinciri baştan sona doğrular (K47). Sessiz değişiklik burada görünür. */
@Injectable()
export class AuditVerifier {
  constructor(private readonly prisma: PrismaService) {}

  async verify(batch = 1000): Promise<ChainCheck> {
    let prev = GENESIS_HASH;
    let after = -1n;
    let checked = 0;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where: { seq: { gt: after } },
        orderBy: { seq: 'asc' },
        take: batch,
      });
      if (rows.length === 0) return { checked, ok: true, brokenAtSeq: null };
      for (const r of rows) {
        const expected = chainHash(prev, {
          id: r.id,
          at: r.at.toISOString(),
          seq: r.seq.toString(),
          actorType: r.actorType,
          actorId: r.actorId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          changesetId: r.changesetId,
          diff: r.diff ?? null,
          reason: r.reason,
          requestId: r.requestId,
          ipHash: r.ipHash,
        });
        if (r.prevHash !== prev || r.hash !== expected) {
          return { checked, ok: false, brokenAtSeq: r.seq.toString() };
        }
        prev = r.hash;
        after = r.seq;
        checked++;
      }
    }
  }
}
