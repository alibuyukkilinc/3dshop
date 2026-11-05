// catalog modülünün dışa açık yüzü (K50).
export { CatalogModule } from '../catalog.module.js';
export { CatalogIngest, type IngestInput, type IngestOutcome } from '../application/catalog-ingest.js';
export { CatalogPriceExpiry, type ExpiredPrice } from '../application/catalog-price-expiry.js';
export { CatalogMappingService } from '../application/catalog-mapping.service.js';
export { CatalogFacts, type ProductFacts, type ProductFactsFilter } from '../application/catalog-facts.js';
