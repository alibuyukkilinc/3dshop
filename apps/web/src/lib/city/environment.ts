import { drawBoard } from '@dtd/scene-runtime';
import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderChunk,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Obstacle } from './movement';
import { type SurfaceKind, type SurfaceKit, applyWorldUv } from './surfaces';
import { facadeTexture, leafTexture } from './textures';
import { drawStoreSign, loadCorsImage } from './store-sign';

/**
 * Şehir ortamı (görsel iyileştirme 1–2): bölgeler arası zemin ve cadde, bordür, şerit çizgileri, yaya
 * geçitleri, tramvay yolu, ağaç/lamba, geçici meydan, ufuktaki silüet ve mağaza tabelaları. Sahne
 * belgelerine (K45) dokunmaz; yalnız istemcinin çizimidir. Kalıcı içerik (park, meydan) editörle sahneye
 * girer; buradaki süsler şehir genelidir.
 */

/** Bölge sahneleriyle aynı yüzey renkleri (scenes-seed): cadde, kaldırım, bölge zemini */
const COLORS = { asphalt: '#4b5563', sidewalk: '#d6d3d1', ground: '#9aa39a', grass: '#ffffff', trackBed: '#8a8d8f', curb: '#b9b6b0' } as const;

type V2 = [number, number];
interface Region {
  polygon: V2[];
  bundle_url: string | null;
}

/** Bir doğru parçasının, paketli bölgelerin kapsamadığı kısımları (t ∈ [0,1] aralıkları) */
function uncovered(a: V2, b: V2, covered: Region[]): [number, number][] {
  const cuts: [number, number][] = [];
  for (const r of covered) {
    const xs = r.polygon.map((p) => p[0]);
    const zs = r.polygon.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    // Kutu ile parça kesişimi (Liang–Barsky)
    let t0 = 0;
    let t1 = 1;
    const d = [b[0] - a[0], b[1] - a[1]];
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      return t0 <= t1;
    };
    if (clip(-d[0]!, a[0] - x0) && clip(d[0]!, x1 - a[0]) && clip(-d[1]!, a[1] - z0) && clip(d[1]!, z1 - a[1])) cuts.push([t0, t1]);
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let t = 0;
  for (const [c0, c1] of cuts) {
    if (c0 > t) out.push([t, c0]);
    t = Math.max(t, c1);
  }
  if (t < 1) out.push([t, 1]);
  return out.filter(([p, q]) => q - p > 1e-3);
}

/** a→b doğrultusunda, yanal kaydırmalı yatay şerit geometrisi (dünya koordinatında) */
function stripGeo(a: V2, b: V2, offset: number, width: number, y: number, along0 = 0, along1?: number): PlaneGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const l1 = along1 ?? len;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const nx = -Math.sin(ang);
  const nz = Math.cos(ang);
  const mid = (along0 + l1) / 2;
  const geo = new PlaneGeometry(l1 - along0, width).rotateX(-Math.PI / 2);
  geo.rotateY(-ang);
  geo.translate(a[0] + dir[0] * mid + nx * offset, y, a[1] + dir[1] * mid + nz * offset);
  return geo;
}

function inBox(p: V2, poly: V2[]): boolean {
  const xs = poly.map((q) => q[0]);
  const zs = poly.map((q) => q[1]);
  return p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...zs) && p[1] <= Math.max(...zs);
}

/** Yatay hat parçalarından x'i kapsayanın z'si (meydan → cadde yaya yolu için) */
function nearestStreetZ(lines: { path: V2[] }[], x: number): number | null {
  for (const l of lines)
    for (let i = 0; i + 1 < l.path.length; i++) {
      const [a, b] = [l.path[i]!, l.path[i + 1]!];
      if (a[1] === b[1] && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])) return a[1];
    }
  return null;
}

export interface CityDecor {
  root: Group;
  obstacles: Obstacle[];
  dispose(): void;
}

export interface DecorOptions {
  shadows: boolean;
  /** Ufuktaki silüet binaları (orta/yüksek kalite) */
  skyline: boolean;
  /** Caddenin hat ucundan dışarı uzantısı (m): sis mesafesinin ötesine, yol ufukta kaybolur */
  reach: number;
}

/**
 * Şehir geneli: zemin, paketsiz bölgelerde cadde + kaldırım, tüm hat boyunca bordür, şerit çizgisi,
 * tramvay yolu ve raylar, ağaç ve lambalar. Cadde ölçüleri bölge sahneleriyle aynı (cadde 14 m,
 * kaldırım 8 m; scenes-seed).
 */
export function createCityDecor(
  bounds: { min: V2; max: V2 },
  regions: Region[],
  lines: { path: V2[]; stations: { position: [number, number, number] | null }[] }[],
  kit: SurfaceKit,
  opts: DecorOptions,
  /** Doğuş noktası (x, z): sahnesiz bölgedeyse geçici meydan buraya kurulur */
  spawn?: V2,
): CityDecor {
  const { shadows } = opts;
  const root = new Group();
  const disposables: { dispose(): void }[] = [];
  const obstacles: Obstacle[] = [];
  const covered = regions.filter((r) => r.bundle_url);

  // Aynı malzemeli yüzeyler tek geometride toplanır (çizim çağrısı az)
  const batches = new Map<Material, BufferGeometry[]>();
  const surface = (geo: BufferGeometry, kind: SurfaceKind, color: string) => {
    applyWorldUv(geo, new Matrix4(), kind);
    const m = kit.material(kind, color);
    const list = batches.get(m) ?? [];
    list.push(geo);
    batches.set(m, list);
  };
  const flat = (geo: BufferGeometry, mat: Material) => {
    const list = batches.get(mat) ?? [];
    list.push(geo);
    batches.set(mat, list);
  };

  // Zemin: şehrin dışına taşan çim; bölge zeminleri (y=0) bunun üstünde kalır
  const midZ = (bounds.min[1] + bounds.max[1]) / 2;
  const depth = bounds.max[1] - bounds.min[1] + 900;
  surface(stripGeo([bounds.min[0] - 450, midZ], [bounds.max[0] + 450, midZ], 0, depth, -0.05), 'grass', COLORS.grass);

  const stations = lines.flatMap((l) => l.stations.flatMap((s) => (s.position ? [[s.position[0], s.position[2]] as V2] : [])));
  const nearStation = (x: number, z: number) => stations.some((s) => Math.hypot(s[0] - x, s[1] - z) < 8);

  const paint = new MeshStandardMaterial({ color: '#f2f1ec', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const rail = new MeshStandardMaterial({ color: '#a7adb3', roughness: 0.25, metalness: 0.95 });
  const curbMat = kit.material('slab', COLORS.curb);
  disposables.push(paint, rail);

  const trees: Matrix4[] = [];
  const lamps: Matrix4[] = [];
  const bins: Matrix4[] = [];
  const signals: Matrix4[] = [];
  const shelters: Matrix4[] = [];
  const wire = new MeshStandardMaterial({ color: '#2b2f33', roughness: 0.5, metalness: 0.6 });
  disposables.push(wire);
  const at = (x: number, z: number, rotY = 0, s = 1) =>
    new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotY), new Vector3(s, s, s));

  for (const line of lines) {
    for (let i = 0; i + 1 < line.path.length; i++) {
      const a = line.path[i]!;
      const b = line.path[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const nrm: V2 = [-dir[1], dir[0]];
      // Cadde sisin ötesine uzanır: ufukta kaybolan yol, trafik orada görünmeden döner
      const ext = opts.reach;
      const A: V2 = [a[0] - dir[0] * ext, a[1] - dir[1] * ext];
      const B: V2 = [b[0] + dir[0] * ext, b[1] + dir[1] * ext];
      const total = len + ext * 2;
      // Paketli bölge dışında kalan yerlerde cadde + iki kaldırım
      for (const [t0, t1] of uncovered(A, B, covered)) {
        const p: V2 = [A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0];
        const q: V2 = [A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1];
        surface(stripGeo(p, q, 0, 14, 0.0), 'asphalt', COLORS.asphalt);
        surface(stripGeo(p, q, -11, 8, 0.1), 'paver', COLORS.sidewalk);
        surface(stripGeo(p, q, 11, 8, 0.1), 'paver', COLORS.sidewalk);
      }
      // Tramvay yolu (beton yatak), raylar ve oluk
      surface(stripGeo(A, B, 0, 2.9, 0.012), 'slab', COLORS.trackBed);
      for (const off of [-0.72, 0.72]) {
        const r = new BoxGeometry(total, 0.05, 0.075);
        r.rotateY(-Math.atan2(dir[1], dir[0]));
        r.translate((A[0] + B[0]) / 2 + nrm[0] * off, 0.035, (A[1] + B[1]) / 2 + nrm[1] * off);
        flat(r, rail);
      }
      // Bordür taşları (kaldırım kenarı, 18 cm)
      for (const side of [-1, 1]) {
        const c = new BoxGeometry(total, 0.18, 0.26);
        c.rotateY(-Math.atan2(dir[1], dir[0]));
        c.translate((A[0] + B[0]) / 2 + nrm[0] * side * 7.05, 0.09, (A[1] + B[1]) / 2 + nrm[1] * side * 7.05);
        applyWorldUv(c, new Matrix4(), 'slab');
        const list = batches.get(curbMat) ?? [];
        list.push(c);
        batches.set(curbMat, list);
      }
      // Şerit çizgileri: tramvay yolu kenarı (sürekli), cadde kenarı (sürekli), şerit ortası (kesikli)
      for (const side of [-1, 1]) {
        flat(stripGeo(A, B, side * 1.65, 0.14, 0.03), paint);
        flat(stripGeo(A, B, side * 6.55, 0.14, 0.03), paint);
        for (let s = 0; s < total - 3; s += 9) flat(stripGeo(A, B, side * 4.1, 0.12, 0.03, s, s + 3), paint);
      }
      // Yaya geçitleri: her durağın iki yanında
      for (const st of stations) {
        const along = (st[0] - A[0]) * dir[0] + (st[1] - A[1]) * dir[1];
        const lateral = (st[0] - A[0]) * nrm[0] + (st[1] - A[1]) * nrm[1];
        if (Math.abs(lateral) > 8 || along < 0 || along > total) continue;
        for (const ds of [-14, 14])
          for (let k = -6.2; k <= 6.2; k += 1.0) {
            if (Math.abs(k) < 1.5) continue;
            flat(stripGeo(A, B, k, 0.5, 0.032, along + ds - 1.6, along + ds + 1.6), paint);
          }
        // Trafik ışıkları: geçidin iki yanında, gelen trafiğe dönük (sağdan akış)
        for (const ds of [-14, 14])
          for (const side of [-1, 1]) {
            const sAt = along + ds - side * 2.4;
            const x = A[0] + dir[0] * sAt + nrm[0] * side * 7.45;
            const z = A[1] + dir[1] * sAt + nrm[1] * side * 7.45;
            signals.push(at(x, z, Math.atan2(-dir[0] * side, -dir[1] * side)));
            obstacles.push({ x, z, r: 0.3 });
          }
        // Durak sığınağı: güney kaldırımında, caddeye dönük
        if (Math.abs(lateral) < 3) {
          const x = st[0] + nrm[0] * 10.4;
          const z = st[1] + nrm[1] * 10.4;
          shelters.push(at(x, z, Math.atan2(-nrm[0], -nrm[1])));
          obstacles.push({ x: x - dir[0] * 1.6, z: z - dir[1] * 1.6, r: 0.9 }, { x, z, r: 0.9 }, { x: x + dir[0] * 1.6, z: z + dir[1] * 1.6, r: 0.9 });
        }
      }
      // Katener: tramvay yolunun üstünde temas teli, iki yandaki lamba direklerine gergi telleri
      flat(new BoxGeometry(total, 0.025, 0.025).rotateY(-Math.atan2(dir[1], dir[0])).translate((A[0] + B[0]) / 2, 5.93, (A[1] + B[1]) / 2), wire);
      for (let s = 6; s < total - 6; s += 36) {
        const x = A[0] + dir[0] * s;
        const z = A[1] + dir[1] * s;
        if (nearStation(x + nrm[0] * 7.5, z + nrm[1] * 7.5)) continue;
        flat(new BoxGeometry(0.02, 0.02, 15).rotateY(-Math.atan2(dir[1], dir[0])).translate(x, 6.0, z), wire);
      }
      // Süsler: kaldırım kenarında lambalar (iki yan, 18 m), dış kaldırımda ağaçlar (12 m). Mağaza önü
      // (cadde kuzeyi, panoların durduğu taraf) ağaçsız bırakılır: vitrin görünsün.
      for (let s = 6; s < total - 6; s += 18) {
        for (const side of [-1, 1]) {
          const x = A[0] + dir[0] * s + nrm[0] * side * 7.5;
          const z = A[1] + dir[1] * s + nrm[1] * side * 7.5;
          if (nearStation(x, z)) continue;
          // Kol caddeye doğru (yerel +z → −normal·yan)
          lamps.push(at(x, z, Math.atan2(-nrm[0] * side, -nrm[1] * side)));
          obstacles.push({ x, z, r: 0.35 });
          if ((s / 18) % 3 === 1) {
            const bx = x + dir[0] * 1.6;
            const bz = z + dir[1] * 1.6;
            bins.push(at(bx, bz));
            obstacles.push({ x: bx, z: bz, r: 0.35 });
          }
        }
      }
      for (let s = 3; s < total - 3; s += 12) {
        const x = A[0] + dir[0] * s + nrm[0] * 13;
        const z = A[1] + dir[1] * s + nrm[1] * 13;
        if (nearStation(x, z)) continue;
        trees.push(at(x, z, s, 0.85 + ((s * 37) % 30) / 100));
        obstacles.push({ x, z, r: 0.6 });
      }
    }
  }

  // Sahnesi henüz yayınlanmamış bölge: geçici meydan (taş zemin, fıskiye, banklar, ağaç halkası). Bölge
  // editörden yayınlanınca paketi gelir ve bu yer tutucu çizilmez.
  if (spawn) {
    const host = regions.find((r) => !r.bundle_url && inBox(spawn, r.polygon));
    if (host) {
      const [cx, cz] = spawn;
      const stone = kit.material('slab', '#d8d2c6');
      const water = new MeshStandardMaterial({ color: '#2f5f73', roughness: 0.04, metalness: 0.2, envMapIntensity: 1.4 });
      const wood = new MeshStandardMaterial({ color: '#7b5434', roughness: 0.75 });
      const iron = new MeshStandardMaterial({ color: '#2a2f33', roughness: 0.45, metalness: 0.8 });
      disposables.push(water, wood, iron);
      const plaza = new CylinderGeometry(19, 19, 0.06, 64).translate(cx, 0.03, cz);
      surface(plaza, 'paver', '#cfc6b6');
      // Caddeye bağlanan yaya yolu
      const toStreet = nearestStreetZ(lines, cx);
      if (toStreet !== null) {
        const sgn = Math.sign(cz - toStreet);
        surface(stripGeo([cx, toStreet + 11 * sgn], [cx, cz - 19 * sgn], 0, 6, 0.04), 'paver', '#cfc6b6');
      }
      const part = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number, rotY = 0) => {
        const m = new Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.y = rotY;
        m.castShadow = shadows;
        m.receiveShadow = shadows;
        m.updateMatrixWorld();
        root.add(m);
        return m;
      };
      // Fıskiye: taş havuz, su yüzeyi, ayak, kase
      const basin = part(new CylinderGeometry(4.2, 4.4, 0.7, 48), stone, cx, 0.35, cz);
      applyWorldUv(basin.geometry, basin.matrixWorld, 'slab');
      part(new CylinderGeometry(3.85, 3.85, 0.1, 48), water, cx, 0.6, cz);
      part(new CylinderGeometry(0.45, 0.6, 2.2, 20), stone, cx, 1.4, cz);
      part(new CylinderGeometry(1.4, 0.6, 0.35, 32), stone, cx, 2.5, cz);
      part(new CylinderGeometry(1.25, 1.25, 0.06, 32), water, cx, 2.66, cz);
      obstacles.push({ x: cx, z: cz, r: 4.6 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const bx = cx + Math.cos(a) * 9;
        const bz = cz + Math.sin(a) * 9;
        const rot = -a + Math.PI / 2;
        // Bank: çıta oturak, arkalık, iki dökme ayak
        const seat = new Group();
        for (let sl = 0; sl < 4; sl++) seat.add(new Mesh(new BoxGeometry(2.0, 0.04, 0.09), wood).translateY(0.46).translateZ(-0.18 + sl * 0.12));
        for (let sl = 0; sl < 3; sl++) seat.add(new Mesh(new BoxGeometry(2.0, 0.09, 0.03), wood).translateY(0.62 + sl * 0.13).translateZ(-0.3));
        for (const lx of [-0.85, 0.85]) seat.add(new Mesh(new BoxGeometry(0.06, 0.46, 0.5), iron).translateX(lx).translateY(0.23).translateZ(-0.05));
        seat.position.set(bx, 0.06, bz);
        seat.rotation.y = rot;
        seat.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh) {
            m.castShadow = shadows;
            m.receiveShadow = shadows;
          }
        });
        root.add(seat);
        obstacles.push({ x: bx, z: bz, r: 0.9 });
      }
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const tx = cx + Math.cos(a) * 15.5;
        const tz = cz + Math.sin(a) * 15.5;
        // Yaya yolu ağzını açık bırak
        if (toStreet !== null && Math.abs(tx - cx) < 4 && Math.sign(tz - cz) === Math.sign(toStreet - cz)) continue;
        trees.push(at(tx, tz, a, 1.1));
        obstacles.push({ x: tx, z: tz, r: 0.6 });
      }
    }
  }

  for (const [mat, geos] of batches) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const m = new Mesh(merged, mat);
    m.receiveShadow = true;
    m.castShadow = shadows && mat === curbMat;
    root.add(m);
  }

  addTrees(root, trees, shadows, disposables);
  addStreetFurniture(root, lamps, bins, shadows, disposables);
  addSignals(root, signals, shadows, disposables);
  addShelters(root, shelters, shadows, disposables);
  if (opts.skyline) addSkyline(root, bounds, lines, disposables);

  return {
    root,
    obstacles,
    dispose() {
      root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh && m.geometry && !disposables.includes(m.geometry)) m.geometry.dispose();
      });
      for (const x of disposables) x.dispose();
    },
  };
}

/**
 * Ağaç: dallı gövde, koyu iç taç (gölge hacmi) ve dışında yaprak kartları (alfa testli, normaller taç
 * merkezinden dışa: yumuşak, hacimli ışık). Örnek başına ton farkı (instanceColor).
 */
function addTrees(root: Group, trees: Matrix4[], shadows: boolean, disposables: { dispose(): void }[]) {
  if (!trees.length) return;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const crownC = new Vector3(0, 4.3, 0);

  const trunkParts: BufferGeometry[] = [new CylinderGeometry(0.13, 0.22, 3.6, 9).translate(0, 1.8, 0)];
  for (let k = 0; k < 4; k++) {
    const br = new CylinderGeometry(0.05, 0.09, 1.6, 6).translate(0, 0.8, 0);
    br.rotateZ(0.7 + rnd() * 0.3);
    br.rotateY((k / 4) * Math.PI * 2 + rnd());
    br.translate(0, 2.6 + rnd() * 0.8, 0);
    trunkParts.push(br);
  }
  const trunkGeo = mergeGeometries(trunkParts.map((g) => g.toNonIndexed()))!;
  for (const g of trunkParts) g.dispose();

  // İç taç: gürültüyle bozulmuş küre
  const core = new IcosahedronGeometry(1, 2);
  const pos = core.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.18 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.7 - v.y * 2.1);
    v.multiplyScalar(n).multiply(new Vector3(1.45, 1.2, 1.45)).add(crownC);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  core.computeVertexNormals();

  // Yaprak kartları
  const cards: BufferGeometry[] = [];
  for (let k = 0; k < 56; k++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dirV = new Vector3(s * Math.cos(th), u * 0.85 + 0.1, s * Math.sin(th)).normalize();
    // Kartlar taç yüzeyine ve biraz içine dağılır: iç gövde görünmez, kenar dalgalı kalır
    const depthK = 0.7 + rnd() * 0.45;
    const c = crownC.clone().add(dirV.clone().multiply(new Vector3(1.9, 1.55, 1.9)).multiplyScalar(depthK));
    const size = 1.3 + rnd() * 0.7;
    const g = new PlaneGeometry(size, size);
    g.lookAt(dirV.clone().add(new Vector3((rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2)));
    g.translate(c.x, c.y, c.z);
    const p = g.getAttribute('position');
    const nrm: number[] = [];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).sub(crownC).normalize();
      nrm.push(v.x, v.y, v.z);
    }
    g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    cards.push(g.toNonIndexed());
    g.dispose();
  }
  const cardGeo = mergeGeometries(cards)!;
  for (const g of cards) g.dispose();

  const leaves = leafTexture();
  const trunkMat = new MeshStandardMaterial({ color: '#5e4a3a', roughness: 0.95 });
  const coreMat = new MeshStandardMaterial({ color: '#33492a', roughness: 0.95 });
  const leafMat = new MeshStandardMaterial({ map: leaves, alphaTest: 0.45, side: DoubleSide, roughness: 0.85 });
  disposables.push(trunkGeo, core, cardGeo, leaves, trunkMat, coreMat, leafMat);

  const tint = new Color();
  const mk = (geo: BufferGeometry, mat: MeshStandardMaterial, cast: boolean, colored: boolean, noAO = false) => {
    const m = new InstancedMesh(geo, mat, trees.length);
    trees.forEach((x, i) => {
      m.setMatrixAt(i, x);
      if (colored) {
        const r = ((i * 7919) % 100) / 100;
        // Doğal ton farkı: zeytin yeşilinden taze yeşile, doygunluk düşük
        tint.setHSL(0.17 + r * 0.08, 0.18 + r * 0.12, 0.5 + r * 0.1);
        m.setColorAt(i, tint.multiplyScalar(1.45));
      }
    });
    m.castShadow = cast && shadows;
    m.receiveShadow = shadows;
    m.userData.noAO = noAO;
    m.computeBoundingSphere();
    root.add(m);
  };
  mk(trunkGeo, trunkMat, true, false);
  mk(core, coreMat, true, false);
  mk(cardGeo, leafMat, true, true, true);
}

/** Lamba (dökme taban, konik direk, kol, armatür) ve çöp kutusu */
function addStreetFurniture(root: Group, lamps: Matrix4[], bins: Matrix4[], shadows: boolean, disposables: { dispose(): void }[]) {
  const base = new CylinderGeometry(0.16, 0.22, 0.6, 12).translate(0, 0.3, 0);
  const pole = new CylinderGeometry(0.055, 0.1, 6.2, 12).translate(0, 3.1, 0);
  const arm = new CylinderGeometry(0.035, 0.045, 1.7, 8).rotateX(Math.PI / 2 - 0.12).translate(0, 6.15, 0.8);
  const lampGeo = mergeGeometries([base.toNonIndexed(), pole.toNonIndexed(), arm.toNonIndexed()])!;
  base.dispose();
  pole.dispose();
  arm.dispose();
  const headGeo = new BoxGeometry(0.32, 0.1, 0.7).translate(0, 6.22, 1.62);
  const lensGeo = new BoxGeometry(0.26, 0.02, 0.6).translate(0, 6.16, 1.62);
  const binGeo = mergeGeometries([new CylinderGeometry(0.26, 0.24, 0.85, 14).translate(0, 0.5, 0).toNonIndexed(), new CylinderGeometry(0.04, 0.04, 0.1, 6).translate(0, 0.05, 0).toNonIndexed()])!;
  const metal = new MeshStandardMaterial({ color: '#2a3036', roughness: 0.42, metalness: 0.75 });
  const lens = new MeshStandardMaterial({ color: '#e9eef2', roughness: 0.2, metalness: 0.1, emissive: '#fff2d0', emissiveIntensity: 0.05 });
  const binMat = new MeshStandardMaterial({ color: '#3d4a42', roughness: 0.55, metalness: 0.5 });
  disposables.push(lampGeo, headGeo, lensGeo, binGeo, metal, lens, binMat);
  const inst = (geo: BufferGeometry, mat: MeshStandardMaterial, mats: Matrix4[], cast: boolean) => {
    if (!mats.length) return;
    const m = new InstancedMesh(geo, mat, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = cast && shadows;
    m.receiveShadow = shadows;
    m.computeBoundingSphere();
    root.add(m);
  };
  inst(lampGeo, metal, lamps, true);
  inst(headGeo, metal, lamps, true);
  inst(lensGeo, lens, lamps, false);
  inst(binGeo, binMat, bins, true);
}

/** Trafik ışığı: direk + üç gözlü kafa (yeşil yanıyor). Yerel +z gelen trafiğe bakar. */
function addSignals(root: Group, mats: Matrix4[], shadows: boolean, disposables: { dispose(): void }[]) {
  if (!mats.length) return;
  const pole = mergeGeometries([
    new CylinderGeometry(0.06, 0.08, 3.4, 10).translate(0, 1.7, 0).toNonIndexed(),
    new BoxGeometry(0.34, 0.95, 0.22).translate(0, 2.95, 0.12).toNonIndexed(),
    new BoxGeometry(0.42, 1.05, 0.03).translate(0, 2.95, -0.01).toNonIndexed(),
  ])!;
  const lamp = (y: number) => new CylinderGeometry(0.095, 0.095, 0.03, 14).rotateX(Math.PI / 2).translate(0, y, 0.245);
  const green = lamp(2.66);
  const off = mergeGeometries([lamp(3.24).toNonIndexed(), lamp(2.95).toNonIndexed()])!;
  const metal = new MeshStandardMaterial({ color: '#23272b', roughness: 0.5, metalness: 0.6 });
  const greenMat = new MeshStandardMaterial({ color: '#0c3', emissive: '#19ff73', emissiveIntensity: 2.2 });
  const offMat = new MeshStandardMaterial({ color: '#2a1d14', roughness: 0.3 });
  disposables.push(pole, green, off, metal, greenMat, offMat);
  for (const [geo, mat, cast] of [
    [pole, metal, true],
    [green, greenMat, false],
    [off, offMat, false],
  ] as const) {
    const m = new InstancedMesh(geo, mat, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = cast && shadows;
    m.computeBoundingSphere();
    root.add(m);
  }
}

/** Durak sığınağı (5 m): dört direk, eğimli çatı, arka ve yan cam, bank, aydınlatmalı reklam panosu */
function addShelters(root: Group, mats: Matrix4[], shadows: boolean, disposables: { dispose(): void }[]) {
  if (!mats.length) return;
  const nx = (g: BufferGeometry) => g.toNonIndexed();
  const frame = mergeGeometries([
    ...[-2.4, 2.4].flatMap((x) => [-0.7, 0.55].map((z) => nx(new BoxGeometry(0.08, 2.6, 0.08).translate(x, 1.3, z)))),
    nx(new BoxGeometry(5.2, 0.12, 1.75).rotateX(-0.06).translate(0, 2.66, -0.05)),
    nx(new BoxGeometry(4.6, 0.06, 0.06).translate(0, 0.3, -0.7)),
    // Bank: oturak ve iki ayak
    nx(new BoxGeometry(3.0, 0.06, 0.42).translate(-0.4, 0.48, -0.42)),
    ...[-1.7, 0.9].map((x) => nx(new BoxGeometry(0.06, 0.45, 0.36).translate(x, 0.23, -0.42))),
  ])!;
  const glass = mergeGeometries([nx(new BoxGeometry(4.7, 2.2, 0.02).translate(0, 1.4, -0.72)), ...[-2.42, 2.42].map((x) => nx(new BoxGeometry(0.02, 2.2, 1.1).translate(x, 1.4, -0.2)))])!;
  const ad = new BoxGeometry(1.25, 1.85, 0.12).translate(1.75, 1.35, -0.62);
  const metal = new MeshStandardMaterial({ color: '#30363c', roughness: 0.45, metalness: 0.7 });
  const glassMat = new MeshStandardMaterial({ color: '#cfe0e8', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
  const adMat = new MeshStandardMaterial({ color: '#e8eef2', emissive: '#f4f7ff', emissiveIntensity: 0.55, roughness: 0.3 });
  disposables.push(frame, glass, ad, metal, glassMat, adMat);
  for (const [geo, mat, cast] of [
    [frame, metal, true],
    [glass, glassMat, false],
    [ad, adMat, true],
  ] as const) {
    const m = new InstancedMesh(geo, mat, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = cast && shadows;
    m.receiveShadow = shadows;
    if (mat === glassMat) m.userData.noAO = true;
    m.computeBoundingSphere();
    root.add(m);
  }
}

/**
 * Ufuk silüeti:şehir sınırının 70–230 m dışında, sisle kaybolan kule ve bloklar. Cephe dokusu dünya
 * koordinatından döşenir (kutu boyu ne olursa olsun kat yüksekliği 3 m kalır); çatılar düz gri.
 */
function addSkyline(root: Group, bounds: { min: V2; max: V2 }, lines: { path: V2[] }[], disposables: { dispose(): void }[]) {
  // Ufka uzanan caddenin koridoru boş kalır (yanal 30 m)
  const onStreet = (x: number, z: number, half: number) =>
    lines.some((l) =>
      l.path.slice(1).some((b, i) => {
        const a = l.path[i]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return Math.abs(((x - a[0]) * -(b[1] - a[1])) / len + ((z - a[1]) * (b[0] - a[0])) / len) < 30 + half;
      }),
    );
  let seed = 97;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bases = ['#b9b4ac', '#9fa6ad', '#c8c0b3', '#8e9499'];
  const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  disposables.push(geo);
  const [x0, z0] = bounds.min;
  const [x1, z1] = bounds.max;
  const groups: Matrix4[][] = bases.map(() => []);
  const colors: Color[][] = bases.map(() => []);
  for (let k = 0; k < 160; k++) {
    // Sınır dikdörtgeninin çevresinde rastgele bir nokta, dışa doğru 70–230 m
    const side = Math.floor(rnd() * 4);
    const t = rnd();
    const out = 70 + rnd() * 160;
    const x = side < 2 ? x0 - 150 + t * (x1 - x0 + 300) : side === 2 ? x0 - out : x1 + out;
    const z = side === 0 ? z0 - out : side === 1 ? z1 + out : z0 - 150 + t * (z1 - z0 + 300);
    const tall = rnd() < 0.2;
    const h = tall ? 45 + rnd() * 60 : 12 + rnd() * 26;
    const w = 14 + rnd() * 22;
    const d = 14 + rnd() * 22;
    const g = Math.floor(rnd() * bases.length);
    if (onStreet(x, z, Math.max(w, d) / 2)) continue;
    groups[g]!.push(new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.floor(rnd() * 2) * (Math.PI / 2)), new Vector3(w, h, d)));
    colors[g]!.push(new Color().setHSL(0.08, 0.05, 0.85 + rnd() * 0.2));
  }
  bases.forEach((b, gi) => {
    if (!groups[gi]!.length) return;
    const tex = facadeTexture(101 + gi, b);
    const mat = new MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFacadeUv;\nvarying float vRoof;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 fwp = vec4(transformed, 1.0);
          vec3 fn = objectNormal;
          #ifdef USE_INSTANCING
            fwp = instanceMatrix * fwp;
            fn = mat3(instanceMatrix) * fn;
          #endif
          fwp = modelMatrix * fwp;
          fn = normalize(mat3(modelMatrix) * fn);
          vRoof = step(0.5, fn.y);
          vFacadeUv = (abs(fn.x) > 0.5 ? vec2(fwp.z, fwp.y) : vec2(fwp.x, fwp.y)) / vec2(12.0, 12.0);`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFacadeUv;\nvarying float vRoof;')
        .replace(
          '#include <map_fragment>',
          ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'mix(texture2D( map, vFacadeUv ), vec4(0.42, 0.42, 0.44, 1.0), vRoof)'),
        );
    };
    const m = new InstancedMesh(geo, mat, groups[gi]!.length);
    groups[gi]!.forEach((x, i) => {
      m.setMatrixAt(i, x);
      m.setColorAt(i, colors[gi]![i]!);
    });
    m.computeBoundingSphere();
    m.userData.noAO = true;
    root.add(m);
    disposables.push(tex, mat);
  });
}

/**
 * Mağaza cephe tabelası: girişin arkasındaki binanın ön yüzüne, zemin katın üstüne. Bina, giriş noktasını
 * x ekseninde kapsayan ve girişin gerisinde kalan en yakın yüksek (≥ 3 m) model düğümüdür.
 */
export function createStoreSign(
  store: { name: string; entrance: [number, number, number] },
  buildings: Object3D[],
  color: string,
  /** Kaynak sitenin logosu (gelince tabela logolu yeniden çizilir) */
  logo?: Promise<string | null>,
): { mesh: Mesh; dispose(): void } | null {
  const [ex, , ez] = store.entrance;
  const box = new Box3();
  let best: Box3 | null = null;
  for (const b of buildings) {
    box.setFromObject(b);
    const size = box.getSize(new Vector3());
    if (size.y < 3) continue;
    if (ex < box.min.x || ex > box.max.x || box.max.z > ez) continue;
    if (!best || box.max.z > best.max.z) best = box.clone();
  }
  if (!best) return null;
  const width = Math.min(9, (best.max.x - best.min.x) * 0.75);
  const height = width / 5;
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.round(1024 / 5);
  drawBoard(cv.getContext('2d')!, cv.width, cv.height, { title: store.name, price_text: '', color });
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  let disposed = false;
  void logo
    ?.then((url) => (url ? loadCorsImage(url) : null))
    .then((img) => {
      if (!img || disposed) return;
      drawStoreSign(cv.getContext('2d')!, cv.width, cv.height, { name: store.name, color, logo: img });
      tex.needsUpdate = true;
    });
  const geo = new BoxGeometry(width, height, 0.12);
  const side = new MeshStandardMaterial({ color, roughness: 0.6 });
  const face = new MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.5 });
  // Kutu yüz sırası: +x, −x, +y, −y, +z (ön), −z
  const mesh = new Mesh(geo, [side, side, side, side, face, side]);
  const y = Math.min(best.max.y - height, Math.max(3.6, best.min.y + 4.2));
  mesh.position.set(ex, y, best.max.z + 0.1);
  mesh.castShadow = true;
  return {
    mesh,
    dispose() {
      disposed = true;
      geo.dispose();
      side.dispose();
      face.dispose();
      tex.dispose();
    },
  };
}
