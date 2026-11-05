import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../../.env', quiet: true });

// Göçler tablo sahibi rolle (dtd_owner) çalışır; uygulama dtd_app rolünü kullanır (DATABASE_URL).
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_MIGRATION_URL ?? '',
  },
});
