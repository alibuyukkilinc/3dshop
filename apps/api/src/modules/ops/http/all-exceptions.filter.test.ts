import { type ArgumentsHost, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ErrorReporter } from '../application/error-reporter.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function host(path = '/api/x?email=a@b.c') {
  const res = { statusCode: 0, body: undefined as unknown, headersSent: false };
  const response = {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    json(body: unknown) {
      res.body = body;
      return this;
    },
    get headersSent() {
      return res.headersSent;
    },
  };
  const request = { method: 'POST', path: path.split('?')[0], get: (h: string) => (h === 'x-request-id' ? 'rid-1' : undefined) };
  const h = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost;
  return { h, res };
}

describe('genel hata filtresi', () => {
  it('beklenmeyen hatayı kaydeder, 500 döner, iç ayrıntı ve sorgu dizesi sızmaz', async () => {
    const report = vi.fn().mockResolvedValue('fp');
    const filter = new AllExceptionsFilter({ report } as unknown as ErrorReporter);
    const { h, res } = host();
    await filter.catch(new Error('veritabanı parolası yanlış: db://u:p@x'), h);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error', message: 'Beklenmeyen bir hata oluştu.', request_id: 'rid-1' });
    expect(report).toHaveBeenCalledWith(expect.any(Error), 'api', { method: 'POST', path: '/api/x', requestId: 'rid-1' });
  });

  it('bilinçli HTTP hatalarını kaydetmez, olduğu gibi döner', async () => {
    const report = vi.fn();
    const filter = new AllExceptionsFilter({ report } as unknown as ErrorReporter);
    const a = host();
    await filter.catch(new BadRequestException({ error: 'invalid_request', message: 'İstek geçersiz.' }), a.h);
    expect(a.res.statusCode).toBe(400);
    expect(a.res.body).toEqual({ error: 'invalid_request', message: 'İstek geçersiz.' });
    const b = host();
    await filter.catch(new ServiceUnavailableException({ status: 'not_ready' }), b.h);
    expect(b.res.statusCode).toBe(503);
    expect(report).not.toHaveBeenCalled();
  });
});
