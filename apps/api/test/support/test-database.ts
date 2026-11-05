import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

/** Entegrasyon testleri yalnız veritabanı adresleri tanımlıysa çalışır (pnpm db:init). */
export const hasDatabase = Boolean(process.env.DATABASE_MIGRATION_URL && process.env.DATABASE_URL);

export interface TestDatabase {
  name: string;
  /** Tablo sahibi rol (göç, test hazırlığı) */
  ownerUrl: string;
  /** Uygulamanın çalışma anı rolü */
  appUrl: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Geçici veritabanı açar, tüm göçleri uygular. Her test dosyası kendi temiz veritabanını kullanır. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  const appBaseUrl = process.env.DATABASE_URL;
  if (!migrationUrl || !appBaseUrl) throw new Error('DATABASE_MIGRATION_URL ve DATABASE_URL gerekli');

  const name = `dtd_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: withDatabase(migrationUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const ownerUrl = withDatabase(migrationUrl, name);
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl },
    stdio: 'pipe',
  });

  return {
    name,
    ownerUrl,
    appUrl: withDatabase(appBaseUrl, name),
    async drop() {
      const client = new pg.Client({ connectionString: withDatabase(migrationUrl, 'postgres') });
      await client.connect();
      try {
        for (let attempt = 1; attempt <= 10; attempt++) {
          try {
            await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
            return;
          } catch (error) {
            if (attempt === 10) {
              console.warn(`Geçici veritabanı silinemedi: ${name} (${(error as Error).message})`);
              return;
            }
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      } finally {
        await client.end();
      }
    },
  };
}
