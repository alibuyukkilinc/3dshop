import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { type Actor, type AdminSessionStage, uuidv7 } from '@dtd/contracts';
import { loadEnv } from '../../../infra/config/env.js';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from '../../../infra/crypto/secrets.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';
import type { ClientInfo } from '../../../infra/http/client-info.js';
import { AuditWriter } from '../../audit/public/index.js';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '../domain/recovery-codes.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../domain/totp.js';
import { burnPasswordCheck, verifyPassword } from './passwords.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
/** Parola sonrası 2FA adımının süresi */
export const PENDING_SESSION_MINUTES = 10;

export interface ResolvedSession {
  sessionId: string;
  stage: AdminSessionStage;
  admin: { id: string; email: string; displayName: string; roles: string[] };
}

export interface IssuedSession {
  token: string;
  stage: AdminSessionStage;
  expiresAt: Date;
}

const fail = (status: HttpStatus, error: string, message: string) => new HttpException({ error, message }, status);
const INVALID = () => fail(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'E-posta veya parola hatalı.');
const LOCKED = () =>
  fail(HttpStatus.TOO_MANY_REQUESTS, 'account_locked', 'Çok fazla hatalı deneme. Bir süre sonra tekrar deneyin.');

/**
 * Yönetici girişi (F0.3): parola -> zorunlu TOTP 2FA -> tam oturum. Oturum belirteci yalnız çerezdedir;
 * veritabanında SHA-256 özeti tutulur. Tam oturuma geçişte belirteç yenilenir (oturum sabitleme koruması).
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async login(emailRaw: string, password: string, client: ClientInfo, now = new Date()): Promise<IssuedSession> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!user || user.status !== 'active') {
      await burnPasswordCheck(password);
      throw INVALID();
    }
    if (user.lockedUntil && user.lockedUntil > now) throw LOCKED();

    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.registerFailure(user.id, user.failedAttempts, 'identity.admin.login_failed', client, now);
      throw INVALID();
    }

    const stage: AdminSessionStage = user.totpSecretEnc ? 'mfa_verify' : 'mfa_setup';
    return this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
      await this.audit.write(tx, {
        actor: adminActor(user.id),
        action: 'identity.admin.password_accepted',
        entity: { type: 'admin_user', id: user.id },
        diff: { next_stage: stage },
        requestId: client.requestId,
        ipHash: client.ipHash,
      });
      return this.issue(tx, user.id, stage, new Date(now.getTime() + PENDING_SESSION_MINUTES * 60_000), client);
    });
  }

  async startMfaSetup(session: ResolvedSession): Promise<{ otpauth_url: string; secret: string }> {
    if (session.stage !== 'mfa_setup') {
      throw fail(HttpStatus.CONFLICT, 'mfa_already_enabled', '2FA bu hesapta zaten kurulu.');
    }
    const env = loadEnv();
    const secret = generateTotpSecret();
    await this.prisma.adminUser.update({
      where: { id: session.admin.id },
      data: { totpPendingSecretEnc: encryptSecret(secret, env.SECRETS_KEY) },
    });
    return { otpauth_url: otpauthUrl(env.TOTP_ISSUER, session.admin.email, secret), secret };
  }

  /** 2FA kodunu (ya da kurtarma kodunu) doğrular; başarılıysa eski oturumu kapatıp tam oturum açar. */
  async verifyMfa(
    session: ResolvedSession,
    code: string,
    client: ClientInfo,
    now = new Date(),
  ): Promise<IssuedSession & { recoveryCodes?: string[] }> {
    if (session.stage === 'full') throw fail(HttpStatus.CONFLICT, 'already_verified', 'Oturum zaten doğrulanmış.');
    const env = loadEnv();
    const user = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: session.admin.id } });
    if (user.lockedUntil && user.lockedUntil > now) throw LOCKED();
    const lastStep = user.totpLastStep === null ? null : Number(user.totpLastStep);

    if (session.stage === 'mfa_setup') {
      if (!user.totpPendingSecretEnc) {
        throw fail(HttpStatus.CONFLICT, 'mfa_setup_not_started', 'Önce 2FA kurulumunu başlatın.');
      }
      const secret = decryptSecret(user.totpPendingSecretEnc, env.SECRETS_KEY);
      const step = verifyTotp(secret, code.trim(), now.getTime(), lastStep);
      if (step === null) {
        await this.registerFailure(user.id, user.failedAttempts, 'identity.admin.mfa_failed', client, now);
        throw fail(HttpStatus.UNAUTHORIZED, 'invalid_code', 'Doğrulama kodu hatalı.');
      }
      const recoveryCodes = generateRecoveryCodes();
      const issued = await this.prisma.$transaction(async (tx) => {
        await tx.adminUser.update({
          where: { id: user.id },
          data: {
            totpSecretEnc: user.totpPendingSecretEnc,
            totpPendingSecretEnc: null,
            totpEnabledAt: now,
            totpLastStep: BigInt(step),
            failedAttempts: 0,
            lastLoginAt: now,
          },
        });
        await tx.adminRecoveryCode.deleteMany({ where: { adminUserId: user.id } });
        await tx.adminRecoveryCode.createMany({
          data: recoveryCodes.map((c) => ({ id: uuidv7(), adminUserId: user.id, codeHash: hashRecoveryCode(c) })),
        });
        await this.audit.write(tx, {
          actor: adminActor(user.id),
          action: 'identity.admin.mfa_enabled',
          entity: { type: 'admin_user', id: user.id },
          requestId: client.requestId,
          ipHash: client.ipHash,
        });
        return this.upgrade(tx, session, user.id, client, now, 'totp');
      });
      return { ...issued, recoveryCodes };
    }

    // mfa_verify: TOTP ya da kurtarma kodu
    const trimmed = code.trim();
    let method: 'totp' | 'recovery_code' | null = null;
    let acceptedStep: number | null = null;
    let recoveryId: string | null = null;
    if (/^\d{6}$/.test(trimmed) && user.totpSecretEnc) {
      acceptedStep = verifyTotp(decryptSecret(user.totpSecretEnc, env.SECRETS_KEY), trimmed, now.getTime(), lastStep);
      if (acceptedStep !== null) method = 'totp';
    } else {
      const normalized = normalizeRecoveryCode(trimmed);
      if (normalized) {
        const match = await this.prisma.adminRecoveryCode.findFirst({
          where: { adminUserId: user.id, codeHash: hashRecoveryCode(normalized), usedAt: null },
        });
        if (match) {
          method = 'recovery_code';
          recoveryId = match.id;
        }
      }
    }
    if (!method) {
      await this.registerFailure(user.id, user.failedAttempts, 'identity.admin.mfa_failed', client, now);
      throw fail(HttpStatus.UNAUTHORIZED, 'invalid_code', 'Doğrulama kodu hatalı.');
    }
    return this.prisma.$transaction(async (tx) => {
      if (recoveryId) {
        // Aynı kodun iki eşzamanlı istekte kullanılmasını engeller
        const used = await tx.adminRecoveryCode.updateMany({
          where: { id: recoveryId, usedAt: null },
          data: { usedAt: now },
        });
        if (used.count !== 1) throw fail(HttpStatus.UNAUTHORIZED, 'invalid_code', 'Doğrulama kodu hatalı.');
      }
      await tx.adminUser.update({
        where: { id: user.id },
        data: {
          failedAttempts: 0,
          lastLoginAt: now,
          ...(acceptedStep !== null ? { totpLastStep: BigInt(acceptedStep) } : {}),
        },
      });
      return this.upgrade(tx, session, user.id, client, now, method!);
    });
  }

  async resolve(token: string | undefined, now = new Date()): Promise<ResolvedSession | null> {
    if (!token || token.length > 200) return null;
    const row = await this.prisma.adminSession.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { adminUser: { include: { roles: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt <= now || row.adminUser.status !== 'active') return null;
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await this.prisma.adminSession.update({ where: { id: row.id }, data: { lastSeenAt: now } });
    }
    return {
      sessionId: row.id,
      stage: row.stage as AdminSessionStage,
      admin: {
        id: row.adminUser.id,
        email: row.adminUser.email,
        displayName: row.adminUser.displayName,
        roles: row.adminUser.roles.map((r) => r.roleCode),
      },
    };
  }

  async logout(session: ResolvedSession, client: ClientInfo, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.adminSession.update({ where: { id: session.sessionId }, data: { revokedAt: now } });
      await this.audit.write(tx, {
        actor: adminActor(session.admin.id),
        action: 'identity.admin.logout',
        entity: { type: 'admin_user', id: session.admin.id },
        requestId: client.requestId,
        ipHash: client.ipHash,
      });
    });
  }

  private async upgrade(
    tx: Tx,
    session: ResolvedSession,
    userId: string,
    client: ClientInfo,
    now: Date,
    method: 'totp' | 'recovery_code',
  ): Promise<IssuedSession> {
    await tx.adminSession.update({ where: { id: session.sessionId }, data: { revokedAt: now } });
    await this.audit.write(tx, {
      actor: adminActor(userId),
      action: method === 'recovery_code' ? 'identity.admin.login_recovery_code' : 'identity.admin.login',
      entity: { type: 'admin_user', id: userId },
      requestId: client.requestId,
      ipHash: client.ipHash,
    });
    const ttlHours = loadEnv().ADMIN_SESSION_TTL_HOURS;
    return this.issue(tx, userId, 'full', new Date(now.getTime() + ttlHours * 3_600_000), client);
  }

  private async issue(
    tx: Tx,
    userId: string,
    stage: AdminSessionStage,
    expiresAt: Date,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const token = randomToken();
    await tx.adminSession.create({
      data: {
        id: uuidv7(),
        tokenHash: sha256Hex(token),
        adminUserId: userId,
        stage,
        expiresAt,
        ipHash: client.ipHash,
        userAgent: client.userAgent,
      },
    });
    return { token, stage, expiresAt };
  }

  private async registerFailure(
    userId: string,
    previous: number,
    action: string,
    client: ClientInfo,
    now: Date,
  ): Promise<void> {
    const attempts = previous + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: userId },
        data: {
          failedAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : undefined,
        },
      });
      await this.audit.write(tx, {
        actor: adminActor(userId),
        action,
        entity: { type: 'admin_user', id: userId },
        diff: { attempts, locked: lock },
        requestId: client.requestId,
        ipHash: client.ipHash,
      });
    });
  }
}

function adminActor(id: string): Actor {
  return { type: 'admin', id };
}
