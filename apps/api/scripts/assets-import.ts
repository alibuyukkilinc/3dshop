/**
 * Yerel bir klasördeki GLB'leri varlık kütüphanesine aktarır (F3.2, K56).
 *
 *   pnpm assets-import -- --dir <klasör> --license cc0 --source-url <adres> --attribution "Kenney (www.kenney.nl)" --tags kenney,city-kit
 *
 * Paketlerdeki modeller dokuyu çoğu zaman dış dosyadan çağırır (Textures/colormap.png). Yükleme kapısı dış
 * kaynağı reddeder (K46); bu betik güvenilir yerel paketteki dokuyu GLB'nin içine gömüp kendi kendine yeten
 * dosya üretir, sonra normal hattan (doğrulama + optimizasyon) yükler. Aynı adlı varlık varsa atlar.
 * Lisans yalnız --verify verilirse doğrulanmış sayılır (lisans dosyası okunduysa).
 */
import 'reflect-metadata';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { NestFactory } from '@nestjs/core';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { type AssetKind, AssetsService, LICENSE_TYPES } from '../src/modules/assets/public/index.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    dir: { type: 'string' },
    license: { type: 'string', default: 'cc0' },
    'source-url': { type: 'string' },
    attribution: { type: 'string' },
    tags: { type: 'string', default: '' },
    /** Modelin birimi metre değilse yerleştirme ölçeği (Kenney: 10) — "scale:10" etiketi olarak saklanır */
    scale: { type: 'string' },
    verify: { type: 'boolean', default: false },
  },
});
if (!values.dir || !LICENSE_TYPES.includes(values.license as (typeof LICENSE_TYPES)[number])) {
  console.error('Kullanım: pnpm assets-import -- --dir <klasör> [--license cc0] [--source-url …] [--attribution …] [--tags a,b] [--verify]');
  process.exit(1);
}

/** Dosya adından tür: detail-* sokak eşyası, diğerleri bina */
const kindOf = (name: string): AssetKind => (/^(detail|prop|tree|bench|lamp|sign)/.test(name) ? 'prop' : 'building');
const title = (name: string) => name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const assets = app.get(AssetsService);
const prisma = app.get(PrismaService);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ctx = { actor: { type: 'system' as const, id: 'assets-import' }, requestId: null, ipHash: null };
const baseTags = [...values.tags!.split(',').map((t) => t.trim()).filter(Boolean), ...(values.scale ? [`scale:${Number(values.scale)}`] : [])];
let done = 0;
let skipped = 0;
try {
  for (const file of readdirSync(values.dir).filter((f) => f.toLowerCase().endsWith('.glb')).sort()) {
    const name = title(basename(file, '.glb'));
    if (await prisma.asset.findFirst({ where: { name, status: { not: 'archived' } } })) {
      skipped++;
      continue;
    }
    // Dış dokuyu çözüp gömer: çıktı tek dosya, uri yok
    const doc = await io.read(join(values.dir, file));
    const glb = Buffer.from(await io.writeBinary(doc));
    const tags = [...baseTags, ...(basename(file).startsWith('low-detail') ? ['low-detail'] : [])];
    await assets.upload(
      glb,
      {
        name,
        kind: kindOf(basename(file, '.glb')),
        tags,
        license: {
          license_type: values.license as (typeof LICENSE_TYPES)[number],
          source_url: values['source-url'] ?? null,
          attribution: values.attribution ?? null,
          verify: values.verify!,
        },
      },
      ctx,
    );
    done++;
  }
  console.log(`${done} varlık yüklendi, ${skipped} zaten vardı. İşleme worker'da sürer (5 sn'de bir).`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await app.close();
}
