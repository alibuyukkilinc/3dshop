/**
 * Pilot bölge sahnelerinin taslak yerleşimi (F3.4, C1). Yayınlamaz: yayın değişiklik setiyle (K44).
 *
 *   pnpm scenes-seed            sahnesi yalnız başlangıç sürümünde olan bölgelere taslak yerleşim kaydeder
 *   pnpm scenes-seed -- --force var olan son sürümün üzerine yeni taslak sürüm yazar
 *
 * Düzen: bölgeyi doğu-batı kesen ana cadde (z = 20, T1 tramvayı), kuzey (z = −14) ve güney (z = 54) sıraları.
 * Pilot mağazalar caddeye bakan büyük binalarda; önlerinde giriş çapası (anchor: store_entrance → mağaza
 * kimliği) ve 6 vitrin yuvası (slot). Kenney modelleri metre değil: ölçek 10.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { AssetsService } from '../src/modules/assets/public/index.js';
import { CommerceFacts } from '../src/modules/commerce/public/index.js';
import { ScenesService } from '../src/modules/scene/public/index.js';
import { PILOT_CITY, WorldService } from '../src/modules/world/public/index.js';

const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { force: { type: 'boolean', default: false } } });

type V3 = [number, number, number];
type Node = { id: string; parent: string | null; name?: string; transform: { p: V3; r: [number, number, number, number]; s: V3 }; components: unknown[] };
const yaw = (deg: number): [number, number, number, number] => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.round(Math.sin(h) * 1e4) / 1e4, 0, Math.round(Math.cos(h) * 1e4) / 1e4];
};
const S = 10;

/** Bölge → pilot mağazalar (ticari-yapi, C1) */
const REGION_STORES: Record<string, string[]> = {
  'enerji-carsisi': ['esensolarmarket', 'ankaragrupsolar', 'solarbank'],
  'egitim-sokagi': ['denemekapsulu', 'netdenemekulubu'],
  'merkez-meydan': [],
};
const STORE_BUILDINGS = ['Building Skyscraper A', 'Building Skyscraper C', 'Building Skyscraper E', 'Building Skyscraper B', 'Building Skyscraper D'];
const FILLER = ['Building A', 'Building B', 'Building C', 'Building D', 'Building E', 'Building F', 'Building G', 'Building H', 'Building J', 'Building K', 'Building L', 'Building M', 'Building N'];

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const scenes = app.get(ScenesService);
const world = app.get(WorldService);
const ctx = { actor: { type: 'system' as const, id: 'scenes-seed' }, requestId: null, ipHash: null };
try {
  const assets = new Map((await app.get(AssetsService).list({ status: 'ready' })).map((a) => [a.name, a.current_version_id!]));
  const stores = new Map((await app.get(CommerceFacts).stores()).map((s) => [s.slug, s]));
  const city = (await world.worlds()).find((w) => w.slug === PILOT_CITY.slug);
  if (!city) throw new Error('Pilot şehir yok: önce pnpm world -- seed-pilot');
  const stations = city.transit_lines.flatMap((l) => l.stations);
  const asset = (name: string) => {
    const id = assets.get(name);
    if (!id) throw new Error(`Varlık yok: ${name} (önce pnpm assets-import)`);
    return id;
  };

  for (const r of city.regions) {
    const { id: sceneId } = await scenes.ensure({ type: 'region', id: r.id }, r.name, ctx);
    const current = await scenes.document(sceneId);
    if (current.number > 1 && !values.force) {
      console.log(`${r.slug}: sürüm ${current.number} var, atlandı (--force ile üzerine taslak yazılır)`);
      continue;
    }
    const base = (current.document as { nodes: Node[] }).nodes.filter((n) => ['isik-gok', 'isik-gunes', 'zemin'].includes(n.id));
    const ground = base.find((n) => n.id === 'zemin')!;
    const cx = ground.transform.p[0];
    const nodes: Node[] = [...base];
    const add = (n: Omit<Node, 'parent' | 'transform'> & { p: V3; deg?: number; s?: number }) =>
      nodes.push({ id: n.id, parent: null, name: n.name, transform: { p: n.p, r: yaw(n.deg ?? 0), s: [n.s ?? 1, n.s ?? 1, n.s ?? 1] }, components: n.components });

    // Cadde ve kaldırımlar (ilkel şekiller; yol varlıkları sonraki sette)
    add({ id: 'cadde', name: 'Ana cadde', p: [cx, 0.02, 20], components: [{ type: 'primitive', shape: 'plane', size: [160, 14], material: { color: '#4b5563', roughness: 0.95 }, castShadow: false }] });
    add({ id: 'kaldirim-k', name: 'Kuzey kaldırım', p: [cx, 0.05, 9], components: [{ type: 'primitive', shape: 'plane', size: [160, 8], material: { color: '#d6d3d1' }, castShadow: false }] });
    add({ id: 'kaldirim-g', name: 'Güney kaldırım', p: [cx, 0.05, 31], components: [{ type: 'primitive', shape: 'plane', size: [160, 8], material: { color: '#d6d3d1' }, castShadow: false }] });

    // Durak
    const station = stations.find((s) => s.name.startsWith(r.name));
    if (station) add({ id: 'durak', name: station.name, p: [cx, 0, 26], components: [{ type: 'anchor', kind: 'station', ref_id: station.place_id }] });

    // Pilot mağazalar: kuzey sıraya, eşit aralıkla
    const slugs = REGION_STORES[r.slug] ?? [];
    const width = 160;
    slugs.forEach((slug, i) => {
      const store = stores.get(slug);
      if (!store) return;
      const x = cx - width / 2 + ((i + 1) * width) / (slugs.length + 1);
      add({ id: `magaza-${slug}`, name: store.name, p: [x, 0, -14], deg: 0, s: S, components: [{ type: 'mesh', asset_version_id: asset(STORE_BUILDINGS[i % STORE_BUILDINGS.length]!), lod_policy: 'auto' }] });
      add({ id: `giris-${slug}`, name: `${store.name} girişi`, p: [x, 0, 4], components: [{ type: 'anchor', kind: 'store_entrance', ref_id: store.id }] });
      for (let k = 0; k < 6; k++) {
        add({ id: `yuva-${slug}-${k + 1}`, name: `${store.name} vitrin ${k + 1}`, p: [x - 7.5 + k * 3, 0, 8], deg: 180, components: [{ type: 'slot', slot_id: `${slug}-vitrin-${k + 1}` }] });
      }
      add({ id: `tente-${slug}`, name: `${store.name} tente`, p: [x, 0, 1], s: S, components: [{ type: 'mesh', asset_version_id: asset('Detail Awning Wide'), lod_policy: 'auto' }] });
    });

    // Dolgu binalar: güney sıra caddeye bakar (180°), kuzeyde mağaza aralarına
    const fillers = FILLER.slice(0, 7);
    fillers.forEach((name, i) => {
      add({ id: `dolgu-g-${i + 1}`, name, p: [cx - 66 + i * 22, 0, 52], deg: 180, s: S, components: [{ type: 'mesh', asset_version_id: asset(name), lod_policy: 'auto' }] });
    });
    // Arka plan: düşük ayrıntılı binalar (uzak görünüm, az üçgen)
    for (let i = 0; i < 8; i++) {
      add({ id: `arka-${i + 1}`, name: 'Arka plan binası', p: [cx - 70 + i * 20, 0, -60], s: S, components: [{ type: 'mesh', asset_version_id: asset(`Low Detail Building ${'ABCDEFGH'[i]}`), lod_policy: 'low' }] });
    }
    // Güneş şemsiyeleri: kaldırımda
    for (let i = 0; i < 4; i++) {
      add({ id: `semsiye-${i + 1}`, name: 'Şemsiye', p: [cx - 60 + i * 40, 0, 34], s: S, components: [{ type: 'mesh', asset_version_id: asset(i % 2 ? 'Detail Parasol A' : 'Detail Parasol B'), lod_policy: 'auto' }] });
    }
    if (r.slug === 'merkez-meydan') {
      add({ id: 'dogus', name: 'Şehir girişi', p: [cx, 0, 60], components: [{ type: 'anchor', kind: 'spawn', ref_id: 'merkez-sehir' }] });
    }

    const saved = await scenes.save(sceneId, { base_number: current.number, document: { schema: 'dtd.scene.v1', units: 'm', background: '#bcd3e6', nodes }, note: 'Pilot taslak yerleşim (scenes-seed)' }, ctx);
    console.log(`${r.slug}: taslak sürüm ${saved.number} (${nodes.length} düğüm, ${slugs.length} mağaza)`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await app.close();
}
