import { Global, Module } from '@nestjs/common';
import { OutboxRelay } from './application/outbox-relay.js';
import { OutboxWriter } from './application/outbox-writer.js';
import { SettingsService } from './application/settings.service.js';

@Global()
@Module({
  providers: [OutboxWriter, OutboxRelay, SettingsService],
  exports: [OutboxWriter, OutboxRelay, SettingsService],
})
export class PlatformModule {}
