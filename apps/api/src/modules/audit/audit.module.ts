import { Global, Module } from '@nestjs/common';
import { AuditVerifier } from './application/audit-verifier.js';
import { AuditWriter } from './application/audit-writer.js';

@Global()
@Module({
  providers: [AuditWriter, AuditVerifier],
  exports: [AuditWriter, AuditVerifier],
})
export class AuditModule {}
