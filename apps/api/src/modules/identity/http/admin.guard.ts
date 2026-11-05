import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AdminAuthService, type ResolvedSession } from '../application/admin-auth.service.js';
import { ADMIN_COOKIE } from './session-cookie.js';

type AdminRequest = Request & { adminSession?: ResolvedSession };

const PARTIAL_KEY = 'dtd:allow-partial-session';
const ROLES_KEY = 'dtd:roles';

/** Uç, 2FA'sı henüz tamamlanmamış (mfa_setup / mfa_verify) oturumla da çağrılabilir. */
export const AllowPartialSession = () => SetMetadata(PARTIAL_KEY, true);
/** Uç yalnız bu rollerden birine sahip yöneticiye açıktır. */
export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Yönetici koruması. Varsayılan: yalnız tam (2FA geçmiş) oturum. Diğer modüllerin yönetim uçları bunu
 * identity/public üzerinden kullanır.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const session = await this.auth.resolve(req.cookies?.[ADMIN_COOKIE] as string | undefined);
    if (!session) {
      throw new HttpException({ error: 'unauthenticated', message: 'Oturum açın.' }, HttpStatus.UNAUTHORIZED);
    }
    const partialOk = this.reflector.getAllAndOverride<boolean>(PARTIAL_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (session.stage !== 'full' && !partialOk) {
      throw new HttpException(
        { error: 'mfa_required', message: 'İki adımlı doğrulamayı tamamlayın.', stage: session.stage },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.some((r) => session.admin.roles.includes(r))) {
      throw new HttpException({ error: 'forbidden', message: 'Bu işlem için yetkiniz yok.' }, HttpStatus.FORBIDDEN);
    }
    req.adminSession = session;
    return true;
  }
}

/** Korumanın çözdüğü oturum. */
export const CurrentAdminSession = createParamDecorator((_: unknown, ctx: ExecutionContext): ResolvedSession => {
  const session = ctx.switchToHttp().getRequest<AdminRequest>().adminSession;
  if (!session) throw new Error('CurrentAdminSession yalnız AdminGuard ile kullanılır');
  return session;
});
