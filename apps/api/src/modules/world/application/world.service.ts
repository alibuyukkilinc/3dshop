import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import type { Tx } from '../../../infra/db/types.js';
import { notFound } from '../../../infra/http/admin-request.js';
import { cellOf, haversineKm } from '../domain/geo.js';

/**
 * Pilot şehir (C1): Merkez Meydan, Enerji Çarşısı, Eğitim Sokağı; aralarında T1 tramvayı, her bölgede bir durak.
 * Koordinatlar metre, x doğu, z güney (Three.js sağ el, Y yukarı — dtd.scene.v1).
 */
export const PILOT_CITY = {
  slug: 'merkez-sehir',
  name: 'Merkez Şehir',
  bounds: { min: [-200, -120], max: [200, 120] },
  regions: [
    { slug: 'merkez-meydan', name: 'Merkez Meydan', kind: 'plaza', x: [-40, 40], station: [0, 0, 20] },
    { slug: 'enerji-carsisi', name: 'Enerji Çarşısı', kind: 'district', x: [40, 200], station: [100, 0, 20] },
    { slug: 'egitim-sokagi', name: 'Eğitim Sokağı', kind: 'street', x: [-200, -40], station: [-100, 0, 20] },
  ],
} as const;

export interface BranchInput {
  storeId: string;
  name: string;
  districtCode: string;
}

/** Dünya, bölge ve yerler (K40). Sahipler başka modüllerde: yalnız ref_type/ref_id ile. */
@Injectable()
export class WorldService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pilot dünyaları kurar; tekrar çağrılabilir (var olanı değiştirmez). */
  async ensurePilotWorlds(): Promise<{ cityId: string; mapId: string; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.world.findUnique({ where: { slug: PILOT_CITY.slug } });
      const map = await tx.world.upsert({
        where: { slug: 'turkiye' },
        create: { id: uuidv7(), typeCode: 'turkey_map', slug: 'turkiye', name: 'Türkiye haritası', bounds: { min: [26, 36], max: [45, 42.2] } },
        update: {},
      });
      if (existing) return { cityId: existing.id, mapId: map.id, created: false };

      const cityId = uuidv7();
      await tx.world.create({ data: { id: cityId, typeCode: 'central_city', slug: PILOT_CITY.slug, name: PILOT_CITY.name, bounds: PILOT_CITY.bounds } });
      const lineId = uuidv7();
      const stations: { placeId: string; sort: number }[] = [];
      for (const [i, r] of PILOT_CITY.regions.entries()) {
        const regionId = uuidv7();
        const [x0, x1] = r.x;
        await tx.region.create({
          data: {
            id: regionId,
            worldId: cityId,
            slug: r.slug,
            name: r.name,
            kind: r.kind,
            sort: i,
            polygon: [
              [x0, -120],
              [x1, -120],
              [x1, 120],
              [x0, 120],
            ],
          },
        });
        const placeId = await this.createVirtualPlace(tx, { kind: 'station', name: `${r.name} durağı`, worldId: cityId, regionId, pos: r.station });
        stations.push({ placeId, sort: i });
        await tx.fastTravelTarget.create({ data: { id: uuidv7(), placeId, label: r.name, kind: 'station' } });
        if (r.slug === 'merkez-meydan') {
          const spawn = await this.createVirtualPlace(tx, { kind: 'spawn', name: 'Şehir girişi', worldId: cityId, regionId, pos: [0, 0, 60] });
          await tx.world.update({ where: { id: cityId }, data: { defaultSpawnPlaceId: spawn } });
        }
      }
      // T1: Eğitim Sokağı ↔ Merkez Meydan ↔ Enerji Çarşısı, bölgelerin önünden geçen düz hat
      await tx.transitLine.create({
        data: {
          id: lineId,
          worldId: cityId,
          code: 'T1',
          name: 'T1 Çarşı Tramvayı',
          path: [
            [-160, 20],
            [160, 20],
          ],
        },
      });
      const order = [2, 0, 1]; // batıdan doğuya: Eğitim, Merkez, Enerji
      for (const [sort, idx] of order.entries()) {
        await tx.transitStation.create({ data: { id: uuidv7(), lineId, placeId: stations[idx]!.placeId, sort } });
      }
      return { cityId, mapId: map.id, created: true };
    });
  }

  /** Mağazanın gerçek şubesi: ilçe merkezinden konum (pilot hassasiyeti district_center). Tekrar çağrılabilir. */
  async ensureBranch(input: BranchInput): Promise<{ placeId: string; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.place.findFirst({ where: { kind: 'branch', refType: 'store', refId: input.storeId } });
      if (existing) return { placeId: existing.id, created: false };
      const area = await tx.adminArea.findUnique({ where: { code: input.districtCode } });
      if (!area || area.level !== 'district') throw notFound(`İlçe bulunamadı: ${input.districtCode}`);
      const placeId = uuidv7();
      await tx.place.create({ data: { id: placeId, kind: 'branch', name: input.name, refType: 'store', refId: input.storeId } });
      await tx.placeGeo.create({
        data: {
          placeId,
          lat: area.lat,
          lng: area.lng,
          provinceCode: area.parentCode,
          districtCode: area.code,
          precision: 'district_center',
          source: 'admin_area_centroid',
        },
      });
      return { placeId, created: true };
    });
  }

  async worlds() {
    const rows = await this.prisma.world.findMany({
      orderBy: { slug: 'asc' },
      include: { regions: { orderBy: { sort: 'asc' } }, transitLines: { include: { stations: { orderBy: { sort: 'asc' } } } } },
    });
    const placeIds = rows.flatMap((w) => w.transitLines.flatMap((l) => l.stations.map((s) => s.placeId)));
    const names = new Map((await this.prisma.place.findMany({ where: { id: { in: placeIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      type: w.typeCode,
      status: w.status,
      bounds: w.bounds,
      scene_id: w.sceneId,
      regions: w.regions.map((r) => ({ id: r.id, slug: r.slug, name: r.name, kind: r.kind, polygon: r.polygon, scene_id: r.sceneId })),
      transit_lines: w.transitLines.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        path: l.path,
        stations: l.stations.map((s) => ({ place_id: s.placeId, name: names.get(s.placeId) ?? '' })),
      })),
    }));
  }

  /** Şubeler (harita pinleri): konum, hassasiyet, il/ilçe adı. */
  async branches(storeIds?: string[]) {
    const rows = await this.prisma.place.findMany({
      where: { kind: 'branch', ...(storeIds && { refId: { in: storeIds } }) },
      include: { geo: true },
      orderBy: { name: 'asc' },
    });
    const codes = [...new Set(rows.flatMap((r) => [r.geo?.provinceCode, r.geo?.districtCode]).filter((c): c is string => Boolean(c)))];
    const areas = new Map((await this.prisma.adminArea.findMany({ where: { code: { in: codes } } })).map((a) => [a.code, a.name]));
    return rows.map((p) => ({
      place_id: p.id,
      store_id: p.refId,
      name: p.name,
      version: p.version,
      geo: p.geo
        ? {
            lat: Number(p.geo.lat),
            lng: Number(p.geo.lng),
            precision: p.geo.precision,
            source: p.geo.source,
            address_line: p.geo.addressLine,
            province: p.geo.provinceCode ? (areas.get(p.geo.provinceCode) ?? null) : null,
            district: p.geo.districtCode ? (areas.get(p.geo.districtCode) ?? null) : null,
            verified_at: p.geo.verifiedAt,
          }
        : null,
    }));
  }

  /** Yakındaki şubeler (pilotta küçük küme: haversine; PostGIS F4'te). */
  async nearbyBranches(lat: number, lng: number, km: number) {
    return (await this.branches())
      .filter((b) => b.geo)
      .map((b) => ({ ...b, distance_km: Math.round(haversineKm(lat, lng, b.geo!.lat, b.geo!.lng) * 10) / 10 }))
      .filter((b) => b.distance_km <= km)
      .sort((a, b) => a.distance_km - b.distance_km);
  }

  /** Bölgenin x-z sınır kutusu (sahne zemini ve editör odağı). */
  async regionBounds(regionId: string): Promise<{ min: [number, number]; max: [number, number] } | null> {
    const r = await this.prisma.region.findUnique({ where: { id: regionId }, select: { polygon: true } });
    const pts = (r?.polygon as [number, number][] | undefined) ?? [];
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    return { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] };
  }

  async adminAreas() {
    return (await this.prisma.adminArea.findMany({ orderBy: [{ level: 'desc' }, { name: 'asc' }] })).map((a) => ({
      code: a.code,
      level: a.level,
      name: a.name,
      parent_code: a.parentCode,
      lat: Number(a.lat),
      lng: Number(a.lng),
    }));
  }

  private async createVirtualPlace(
    tx: Tx,
    p: { kind: string; name: string; worldId: string; regionId: string; pos: readonly [number, number, number] },
  ): Promise<string> {
    const id = uuidv7();
    const [x, y, z] = p.pos;
    const { cellX, cellZ } = cellOf(x, z, 64);
    await tx.place.create({ data: { id, kind: p.kind, name: p.name } });
    await tx.placeVirtual.create({ data: { placeId: id, worldId: p.worldId, regionId: p.regionId, x, y, z, cellX, cellZ } });
    return id;
  }
}
