import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import { clientInfo } from './client-info.js';

/** Gövde/sorgu doğrulaması: geçersizse 400, alan hataları yanıtta (kişisel veri içermez). */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new HttpException(
      {
        error: 'invalid_request',
        message: 'İstek geçersiz.',
        fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return r.data;
}

/** Yönetim işlemlerinin denetim kaydı bağlamı (K47). */
export interface AdminContext {
  actor: { type: 'admin'; id: string };
  requestId: string | null;
  ipHash: string | null;
}

export function adminContext(adminId: string, req: Request): AdminContext {
  const c = clientInfo(req);
  return { actor: { type: 'admin', id: adminId }, requestId: c.requestId, ipHash: c.ipHash };
}

export const notFound = (message = 'Kayıt bulunamadı.') =>
  new HttpException({ error: 'not_found', message }, HttpStatus.NOT_FOUND);
export const conflict = (message: string) => new HttpException({ error: 'conflict', message }, HttpStatus.CONFLICT);
