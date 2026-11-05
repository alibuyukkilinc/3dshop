import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { CatalogFacts } from './application/catalog-facts.js';
import { CatalogIngest } from './application/catalog-ingest.js';
import { CatalogQuery } from './application/catalog-query.js';
import { CatalogMappingService } from './application/catalog-mapping.service.js';
import { CatalogPriceExpiry } from './application/catalog-price-expiry.js';
import { CatalogAdminController } from './http/catalog-admin.controller.js';

@Module({
  imports: [CommerceModule, IdentityModule],
  controllers: [CatalogAdminController],
  providers: [CatalogIngest, CatalogPriceExpiry, CatalogMappingService, CatalogFacts, CatalogQuery],
  exports: [CatalogIngest, CatalogPriceExpiry, CatalogMappingService, CatalogFacts, CatalogQuery],
})
export class CatalogModule {}
