import { Injectable } from '@nestjs/common';
import { SYSTEM_ACTOR, uuidv7 } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { AuditWriter } from '../../audit/public/index.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from './passwords.js';

export const ADMIN_ROLES = ['platform_admin', 'editor', 'approver'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface CreateAdminInput {
  email: string;
  displayName: string;
  password: string;
  roles: AdminRole[];
}

/** Yönetici hesapları. İlk sürümde kayıt yok: hesaplar CLI ile açılır (pnpm admin:create). */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async create(input: CreateAdminInput): Promise<{ id: string }> {
    const email = input.email.trim().toLowerCase();
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı`);
    }
    if (input.roles.length === 0) throw new Error('En az bir rol gerekli');
    const passwordHash = await hashPassword(input.password);
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.create({
        data: {
          id,
          email,
          displayName: input.displayName.trim(),
          passwordHash,
          roles: { create: input.roles.map((roleCode) => ({ roleCode })) },
        },
      });
      await this.audit.write(tx, {
        actor: SYSTEM_ACTOR,
        action: 'identity.admin.created',
        entity: { type: 'admin_user', id },
        diff: { email, roles: input.roles },
      });
    });
    return { id };
  }

  /** 2FA'sı kurulu, aktif onaylayıcılar (esnek dört göz, K44). */
  async activeApproverIds(): Promise<string[]> {
    const rows = await this.prisma.adminUser.findMany({
      where: { status: 'active', totpEnabledAt: { not: null }, roles: { some: { roleCode: 'approver' } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Bir yöneticinin rolleri (yayın kısıtları hazırlayana göre denetlenir, K44). */
  async rolesOf(adminId: string): Promise<string[]> {
    const rows = await this.prisma.adminUserRole.findMany({ where: { adminUserId: adminId }, select: { roleCode: true } });
    return rows.map((r) => r.roleCode);
  }
}
