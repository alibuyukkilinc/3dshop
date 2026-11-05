import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/public/index.js';
import { IdentityModule } from '../identity/public/index.js';
import { CatalogIngest } from './application/catalog-ingest.js';
import { CatalogMappingService } from './application/catalog-mapping.service.js';
import { CatalogPriceExpiry } from './application/catalog-price-expiry.js';
import { CatalogAdminController } from './http/catalog-admin.controller.js';

@Module({
  imports: [CommerceModule, IdentityModule],
  controllers: [CatalogAdminController],
  providers: [CatalogIngest, CatalogPriceExpiry, CatalogMappingService],
  exports: [CatalogIngest, CatalogPriceExpiry, CatalogMappingService],
})
export class CatalogModule {}
