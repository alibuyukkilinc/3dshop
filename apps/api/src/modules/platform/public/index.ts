// platform modülünün dışa açık yüzü (K50). Diğer modüller yalnız buradan import eder.
export { PlatformModule } from '../platform.module.js';
export { OutboxWriter, type NewEvent } from '../application/outbox-writer.js';
export { OutboxRelay, type EventHandler, MAX_ATTEMPTS } from '../application/outbox-relay.js';
export { SettingsService } from '../application/settings.service.js';
export {
  PublishableRegistry,
  type Publishable,
  type PublishItem,
  type PublishContext,
} from '../application/publishable-registry.js';
