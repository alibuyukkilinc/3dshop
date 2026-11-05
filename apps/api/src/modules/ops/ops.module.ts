import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { IdentityModule } from '../identity/public/index.js';
import { AlertMailer } from './application/alert-mailer.js';
import { AlertService } from './application/alert.service.js';
import { ErrorReporter } from './application/error-reporter.js';
import { AllExceptionsFilter } from './http/all-exceptions.filter.js';
import { OpsAdminController } from './http/ops-admin.controller.js';
import { MailSender } from './infrastructure/mail-sender.js';

const core = [ErrorReporter, AlertService, AlertMailer, MailSender];

/** API için: hata filtresi + yönetim uçları. */
@Module({
  imports: [IdentityModule],
  controllers: [OpsAdminController],
  providers: [...core, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
  exports: core,
})
export class OpsModule {}

/** Worker için: HTTP olmadan hata kaydı ve uyarı gönderimi. */
@Module({
  providers: core,
  exports: core,
})
export class OpsWorkerModule {}
