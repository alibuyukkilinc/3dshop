import { Module } from '@nestjs/common';
import { CatalogIngest } from './application/catalog-ingest.js';
import { CatalogPriceExpiry } from './application/catalog-price-expiry.js';

@Module({
  providers: [CatalogIngest, CatalogPriceExpiry],
  exports: [CatalogIngest, CatalogPriceExpiry],
})
export class CatalogModule {}
