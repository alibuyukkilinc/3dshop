import { Global, Module } from '@nestjs/common';
import { OutboxRelay } from './application/outbox-relay.js';
import { OutboxWriter } from './application/outbox-writer.js';
import { PublishableRegistry } from './application/publishable-registry.js';
import { SettingsService } from './application/settings.service.js';

@Global()
@Module({
  providers: [OutboxWriter, OutboxRelay, SettingsService, PublishableRegistry],
  exports: [OutboxWriter, OutboxRelay, SettingsService, PublishableRegistry],
})
export class PlatformModule {}
