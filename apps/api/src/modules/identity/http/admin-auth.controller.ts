import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type AdminLoginResult,
  AdminLoginSchema,
  type AdminMe,
  MfaCodeSchema,
  type MfaSetupResult,
  type MfaVerifyResult,
} from '@dtd/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { clientInfo } from '../../../infra/http/client-info.js';
import { RateLimiter } from '../../../infra/http/rate-limit.js';
import { AdminAuthService, type ResolvedSession } from '../application/admin-auth.service.js';
import { AdminGuard, AllowPartialSession, CurrentAdminSession } from './admin.guard.js';
import { clearAdminCookie, setAdminCookie } from './session-cookie.js';

// IP başına: 5 dakikada 20 giriş/doğrulama denemesi (hesap kilidi ayrıca veritabanında)
const limiter = new RateLimiter(20, 5 * 60_000);

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HttpException({ error: 'invalid_request', message: 'İstek geçersiz.' }, HttpStatus.BAD_REQUEST);
  }
  return r.data;
}

function limit(req: Request) {
  const key = clientInfo(req).ipHash ?? 'unknown';
  if (!limiter.take(key)) {
    throw new HttpException(
      { error: 'rate_limited', message: 'Çok fazla deneme. Biraz bekleyin.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Controller('admin/v1/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    limit(req);
    const input = parse(AdminLoginSchema, body);
    const issued = await this.auth.login(input.email, input.password, clientInfo(req));
    setAdminCookie(res, issued.token, issued.expiresAt);
    const result: AdminLoginResult = { stage: issued.stage };
    return result;
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AllowPartialSession()
  async mfaSetup(@CurrentAdminSession() session: ResolvedSession): Promise<MfaSetupResult> {
    return this.auth.startMfaSetup(session);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AllowPartialSession()
  async mfaVerify(
    @CurrentAdminSession() session: ResolvedSession,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MfaVerifyResult> {
    limit(req);
    const { code } = parse(MfaCodeSchema, body);
    const issued = await this.auth.verifyMfa(session, code, clientInfo(req));
    setAdminCookie(res, issued.token, issued.expiresAt);
    return issued.recoveryCodes ? { stage: 'full', recovery_codes: issued.recoveryCodes } : { stage: 'full' };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @AllowPartialSession()
  async logout(
    @CurrentAdminSession() session: ResolvedSession,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(session, clientInfo(req));
    clearAdminCookie(res);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@CurrentAdminSession() session: ResolvedSession): AdminMe {
    return {
      id: session.admin.id,
      email: session.admin.email,
      display_name: session.admin.displayName,
      roles: session.admin.roles,
    };
  }
}
