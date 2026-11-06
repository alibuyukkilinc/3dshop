/**
 * Mağaza bakımı (CLI).
 *
 *   pnpm stores -- branding                   tüm mağazaların logo/ikonunu firmanın web sitesinden okur
 *   pnpm stores -- branding --store solarbank yalnız bir mağaza
 *
 * Yönetim panelindeki "Siteden yenile" ile aynı iş (POST /admin/v1/commerce/stores/:id/branding/refresh).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { StoreBrandingService } from '../src/modules/commerce/public/index.js';

const { positionals, values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: { store: { type: 'string' } },
});

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
let exitCode = 0;
try {
  if (positionals[0] !== 'branding') throw new Error('Kullanım: pnpm stores -- branding [--store <slug>]');
  const prisma = app.get(PrismaService);
  const stores = await prisma.store.findMany({ where: values.store ? { slug: values.store } : {}, select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
  if (!stores.length) throw new Error('Mağaza bulunamadı.');
  const branding = app.get(StoreBrandingService);
  for (const s of stores) {
    try {
      const r = await branding.refresh(s.id, { actor: { type: 'system', id: 'cli:stores' }, requestId: null, ipHash: null });
      console.log(`${s.slug}: ${r.changed ? 'güncellendi' : 'değişmedi'} — logo ${r.logo ?? '-'} · ikon ${r.icon ?? '-'}`);
    } catch (e) {
      exitCode = 1;
      console.error(`${s.slug}: ${(e as Error).message}`);
    }
  }
} catch (e) {
  exitCode = 1;
  console.error((e as Error).message);
} finally {
  await app.close();
}
process.exit(exitCode);
