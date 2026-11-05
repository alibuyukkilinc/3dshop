import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorReporter } from '../application/error-reporter.js';

/**
 * Tüm API hataları buradan geçer. Bilinçli HTTP hataları (4xx, 503 gibi) olduğu gibi döner; beklenmeyen hatalar
 * kayda alınır ve kullanıcıya iç ayrıntı gösterilmeden 500 döner.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly reporter: ErrorReporter) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res
        .status(exception.getStatus())
        .json(typeof body === 'string' ? { error: 'error', message: body } : body);
      return;
    }

    const requestId = req.get?.('x-request-id') ?? null;
    await this.reporter.report(exception, 'api', {
      method: req.method,
      // Sorgu dizesi kişisel veri taşıyabilir: yalnız yol
      path: req.path,
      requestId,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: 'Beklenmeyen bir hata oluştu.', request_id: requestId });
    }
  }
}
