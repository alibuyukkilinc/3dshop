import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/public/index.js';
import { CommerceModule } from '../commerce/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { SOURCE_CLIENT_FACTORY, type SourceClientFactory, SourceSyncService } from './application/source-sync.service.js';
import { SourceSitesService } from './application/source-sites.service.js';
import { IntegrationAdminController } from './http/integration-admin.controller.js';
import { EticaretClient } from './infrastructure/eticaret-client.js';

const eticaretClientFactory: SourceClientFactory = ({ baseUrl, token }) => new EticaretClient(baseUrl, token);

@Module({
  imports: [CatalogModule, CommerceModule, IdentityModule],
  controllers: [IntegrationAdminController],
  providers: [SourceSyncService, SourceSitesService, { provide: SOURCE_CLIENT_FACTORY, useValue: eticaretClientFactory }],
  exports: [SourceSyncService, SourceSitesService],
})
export class IntegrationModule {}
