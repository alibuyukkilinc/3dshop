/**
 * Kaynak siteler (F1.1). Yönetim ekranı gelene kadar (F1.3) bu CLI kullanılır.
 *
 *   pnpm sources -- seed-pilot                      5 pilot siteyi, firmalarını ve mağazalarını açar (token'sız)
 *   pnpm sources -- token --site esensolarmarket    token'ı standart girdiden okur, şifreli saklar
 *   pnpm sources -- sync --site esensolarmarket [--kind full|delta]
 *   pnpm sources -- list
 *
 * Token: kaynak sitenin panelinde products.public_read kapsamıyla açılır (buy_price dönmez, K41).
 * Ekrana ya da loga yazılmaz; komut satırı argümanı olarak da verilmez (kabuk geçmişine düşmesin).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { PILOT_SITES, SourceSitesService, SourceSyncService, type SyncKind } from '../src/modules/integration/public/index.js';

const { positionals, values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: { site: { type: 'string' }, kind: { type: 'string', default: 'full' } },
});
const command = positionals[0];

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) process.stdout.write('Token (products.public_read) yapıştırıp Enter: ');
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const sites = app.get(SourceSitesService);
let exitCode = 0;
try {
  switch (command) {
    case 'seed-pilot':
      for (const seed of PILOT_SITES) {
        const r = await sites.register(seed);
        console.log(`${seed.code}: ${r.created ? 'açıldı' : 'zaten var'}`);
      }
      break;
    case 'token': {
      if (!values.site) throw new Error('--site gerekli');
      await sites.setToken(values.site, await readTokenFromStdin());
      console.log(`${values.site}: token kaydedildi (şifreli).`);
      break;
    }
    case 'sync': {
      if (!values.site) throw new Error('--site gerekli');
      const kind = values.kind as SyncKind;
      if (kind !== 'full' && kind !== 'delta') throw new Error('--kind full ya da delta olmalı');
      console.log(await app.get(SourceSyncService).run(values.site, kind));
      break;
    }
    case 'list':
      console.table(
        (await sites.list()).map((s) => ({
          site: s.code,
          token: s.hasToken ? 'var' : 'YOK',
          filigran: s.watermark ?? '-',
          tam: s.lastFullSyncAt?.toISOString() ?? '-',
          delta: s.lastDeltaSyncAt?.toISOString() ?? '-',
          hata: s.consecutiveFailures ? `${s.consecutiveFailures}× ${s.lastError ?? ''}` : '',
        })),
      );
      break;
    default:
      console.error('Kullanım: pnpm sources -- seed-pilot | token --site <kod> | sync --site <kod> [--kind full|delta] | list');
      exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
