/**
 * Mekân (F3.1).
 *
 *   pnpm world -- seed-pilot     pilot şehri, Türkiye haritasını ve 5 mağazanın şube pinlerini kurar (tekrar çalışabilir)
 *   pnpm world -- list
 *
 * Şube konumu pilotta ilçe merkezidir (kullanıcı kararı 2026-11-06); gerçek adres panelden (map_pin) girilir.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { CommerceFacts } from '../src/modules/commerce/public/index.js';
import { WorldService } from '../src/modules/world/public/index.js';

/** Mağaza adresi (slug) → ilçe (ticari-yapi dalı, A2). */
export const PILOT_BRANCH_DISTRICTS: Record<string, string> = {
  esensolarmarket: '37-tosya',
  ankaragrupsolar: '06-akyurt',
  solarbank: '63-merkez',
  denemekapsulu: '34-atasehir',
  netdenemekulubu: '05-merzifon',
};

const { positionals } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), allowPositionals: true });
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const world = app.get(WorldService);
let exitCode = 0;
try {
  if (positionals[0] === 'seed-pilot') {
    const w = await world.ensurePilotWorlds();
    console.log(`Şehir ve harita: ${w.created ? 'kuruldu' : 'zaten var'}`);
    for (const s of await app.get(CommerceFacts).stores()) {
      const district = PILOT_BRANCH_DISTRICTS[s.slug];
      if (!district) {
        console.log(`${s.slug}: ilçe eşlemesi yok, atlandı`);
        continue;
      }
      const b = await world.ensureBranch({ storeId: s.id, name: s.name, districtCode: district });
      console.log(`${s.slug}: şube pini ${b.created ? 'açıldı' : 'zaten var'} (${district})`);
    }
  } else if (positionals[0] === 'list') {
    console.table((await world.branches()).map((b) => ({ şube: b.name, il: b.geo?.province, ilçe: b.geo?.district, enlem: b.geo?.lat, boylam: b.geo?.lng, hassasiyet: b.geo?.precision })));
  } else {
    console.error('Kullanım: pnpm world -- seed-pilot | list');
    exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
