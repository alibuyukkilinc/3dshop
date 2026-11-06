import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BlobStore } from '../../../infra/storage/blob-store.js';
import { AssetsService } from '../../assets/public/index.js';
import { CatalogQuery } from '../../catalog/public/index.js';
import { CommerceFacts } from '../../commerce/public/index.js';
import { SettingsService } from '../../platform/public/index.js';
import { VisibilityService } from '../../rules/public/index.js';
import { ScenesService } from '../../scene/public/index.js';
import { WorldService } from '../../world/public/index.js';
import { type BundleNode, type RegionBundle, type V3, nearestStore, priceText } from '../domain/bundle.js';

export const BUNDLE_KEY = (regionId: string) => `delivery.bundle.${regionId}`;
export const DIRTY_KEY = 'delivery.dirty';
export interface BundlePointer {
  key: string;
  content_hash: string;
  scene_version_id: string;
  built_at: string;
}

const CHANNEL = '3d' as const;
const BOARD = { width: 2.4, height: 1.8, lift: 1.5 };

/**
 * Bölge paketlerini derler (K48). Yayındaki sahne + 3d kanalında görünen mağaza/ürünler + varlık adresleri.
 * Derleme hata verirse önceki paket işaretçisi değişmez (istemci eski paketle çalışmaya devam eder, K51).
 */
@Injectable()
export class BundlesService {
  private readonly logger = new Logger('delivery');
  private readonly store = BlobStore.fromEnv();

  constructor(
    private readonly scenes: ScenesService,
    private readonly world: WorldService,
    private readonly assets: AssetsService,
    private readonly visibility: VisibilityService,
    private readonly catalog: CatalogQuery,
    private readonly commerce: CommerceFacts,
    private readonly settings: SettingsService,
  ) {}

  /** Sahne/görünürlük değişince işaretlenir; worker toplu derler. */
  async markDirty(): Promise<void> {
    await this.settings.set(DIRTY_KEY, { at: new Date().toISOString() });
  }

  async buildIfDirty(): Promise<number> {
    const dirty = await this.settings.get<{ at: string } | null>(DIRTY_KEY, null);
    if (!dirty) return 0;
    await this.settings.set(DIRTY_KEY, null);
    try {
      return await this.buildAll();
    } catch (e) {
      // Bir sonraki tikte yeniden denensin
      await this.settings.set(DIRTY_KEY, dirty);
      throw e;
    }
  }

  async buildAll(): Promise<number> {
    let built = 0;
    for (const w of await this.world.worlds()) {
      for (const r of w.regions) {
        try {
          if (await this.buildRegion(w.slug, r.id)) built++;
        } catch (e) {
          this.logger.error(`${w.slug}/${r.slug} paketi derlenemedi, önceki paket kalıyor: ${(e as Error).message}`);
        }
      }
    }
    return built;
  }

  /** Bölgenin paketini derler; yayında sahne yoksa false. */
  async buildRegion(worldSlug: string, regionId: string): Promise<boolean> {
    const w = await this.world.worldBySlug(worldSlug);
    const region = w?.regions.find((r) => r.id === regionId);
    if (!w || !region) return false;
    const scene = await this.scenes.byOwner('region', regionId);
    if (!scene?.liveVersionId) return false;
    const live = (await this.scenes.live(scene.id))!;
    const doc = live.document as unknown as RegionBundle['document'];

    // Mağaza girişleri: yalnız 3d kanalında görünen mağazalar
    const entranceNodes = doc.nodes.filter((n) => n.components.some((c) => c.type === 'anchor' && c.kind === 'store_entrance'));
    const storeIds = [...new Set(entranceNodes.map((n) => n.components.find((c) => c.type === 'anchor')!.ref_id as string))];
    const visibleStores = await this.visibility.visibleIds('store', CHANNEL, storeIds);
    const storeRows = await this.commerce.publicStores([...visibleStores]);
    const stores = storeRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      entrance: entranceNodes.find((n) => n.components.some((c) => c.ref_id === s.id))!.transform.p as V3,
    }));

    // Yuvalar → en yakın mağaza → o mağazanın 3d'de görünen ürünleri (geçici sıralama; kural tabanlı yerleşim F5)
    const slots = doc.nodes.filter((n) => n.components.some((c) => c.type === 'slot'));
    const byStore = new Map<string, BundleNode[]>();
    for (const s of slots) {
      const owner = nearestStore(s.transform.p as V3, stores);
      if (owner) byStore.set(owner, [...(byStore.get(owner) ?? []), s]);
    }
    const nodes: BundleNode[] = [...doc.nodes];
    const boards: RegionBundle['boards'] = [];
    const boosts = await this.visibility.boosts('product', CHANNEL);
    for (const [storeId, storeSlots] of byStore) {
      const ids = await this.visibility.visibleProductIdsOfStore(storeId, CHANNEL);
      const { items } = await this.catalog.list({ productIds: ids, sort: 'relevance', offset: 0, limit: storeSlots.length, boosts });
      storeSlots.sort((a, b) => a.transform.p[0] - b.transform.p[0]);
      items.forEach((p, i) => {
        const slot = storeSlots[i]!;
        const slotId = slot.components.find((c) => c.type === 'slot')!.slot_id as string;
        const nodeId = `pano-${slotId}`;
        nodes.push({
          id: nodeId,
          parent: slot.id,
          name: p.name,
          transform: { p: [0, BOARD.lift, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
          components: [
            {
              type: 'board',
              width: BOARD.width,
              height: BOARD.height,
              product_id: p.id,
              title: p.name.slice(0, 80),
              price_text: priceText(p.price?.final_minor, p.price?.currency),
              color: '#0f766e',
              ...(p.image && { image_url: p.image.replace(/_high\.(webp|jpe?g|png)$/i, '_medium.$1') }),
            },
          ],
        });
        boards.push({ node_id: nodeId, slot_id: slotId, store_id: storeId, product_id: p.id, position: slot.transform.p as V3 });
      });
    }

    const versionIds = [...new Set(doc.nodes.flatMap((n) => n.components.filter((c) => c.type === 'mesh').map((c) => c.asset_version_id as string)))];
    const files = await this.assets.files(versionIds);
    const assets: RegionBundle['assets'] = {};
    for (const [v, f] of Object.entries(files)) {
      assets[v] = Object.fromEntries(Object.entries(f).map(([lod, key]) => [lod, `/api/v1/assets/files/${key}`]));
    }

    const stationIds = w.transit_lines.flatMap((l) => l.stations.map((s) => s.place_id));
    const pos = await this.world.placePositions(stationIds);
    const bundle: RegionBundle = {
      schema: 'dtd.region-bundle.v1',
      world: { slug: w.slug, name: w.name },
      region: { id: region.id, slug: region.slug, name: region.name, polygon: region.polygon as [number, number][] },
      scene: { id: scene.id, version_id: live.version_id, number: live.number },
      document: { ...doc, nodes },
      assets,
      stores,
      stations: w.transit_lines.flatMap((l) => l.stations).map((s) => ({ place_id: s.place_id, name: s.name, position: pos.get(s.place_id) ?? [0, 0, 0] })),
      boards,
      built_at: new Date().toISOString(),
    };
    // İçerik (derleme zamanı hariç) değişmediyse işaretçi yerinde kalır: istemci önbelleği geçerli kalır
    const contentHash = createHash('sha256').update(JSON.stringify({ ...bundle, built_at: '' })).digest('hex');
    const prev = await this.settings.get<BundlePointer | null>(BUNDLE_KEY(region.id), null);
    if (prev?.content_hash === contentHash && this.store.exists(prev.key)) return true;
    const file = await this.store.put(Buffer.from(JSON.stringify(bundle)), 'json');
    await this.settings.set(BUNDLE_KEY(region.id), {
      key: file.key,
      content_hash: contentHash,
      scene_version_id: live.version_id,
      built_at: bundle.built_at,
    });
    this.logger.log(`${w.slug}/${region.slug}: paket ${file.key.slice(0, 12)}… (${nodes.length} düğüm, ${boards.length} pano, ${Math.round(file.bytes / 1024)} KB)`);
    return true;
  }

  /** İstemci girişi: dünya, bölgeler ve paket adresleri, doğuş noktası, tramvay. */
  async worldManifest(slug: string) {
    const w = await this.world.worldBySlug(slug);
    if (!w) return null;
    const pointers = new Map((await this.settings.list<BundlePointer>('delivery.bundle.')).map((p) => [p.key.slice('delivery.bundle.'.length), p.value]));
    const stationIds = w.transit_lines.flatMap((l) => l.stations.map((s) => s.place_id));
    const pos = await this.world.placePositions(stationIds);
    return {
      world: { slug: w.slug, name: w.name, type: w.type },
      spawn: (await this.world.spawnOf(slug)) ?? [0, 0, 0],
      regions: w.regions.map((r) => {
        const p = pointers.get(r.id);
        return { id: r.id, slug: r.slug, name: r.name, polygon: r.polygon, bundle_url: p ? `/api/v1/bundles/${p.key}` : null };
      }),
      transit_lines: w.transit_lines.map((l) => ({
        code: l.code,
        name: l.name,
        path: l.path,
        stations: l.stations.map((s) => ({ place_id: s.place_id, name: s.name, position: pos.get(s.place_id) ?? null })),
      })),
    };
  }

  bundleExists(key: string) {
    return this.store.exists(key);
  }

  bundleStream(key: string) {
    return this.store.stream(key);
  }
}
