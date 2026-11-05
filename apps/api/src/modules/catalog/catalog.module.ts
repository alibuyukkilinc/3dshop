import { Module } from '@nestjs/common';
import { CatalogIngest } from './application/catalog-ingest.js';

@Module({
  providers: [CatalogIngest],
  exports: [CatalogIngest],
})
export class CatalogModule {}
