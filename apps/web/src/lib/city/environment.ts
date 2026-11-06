import { drawBoard } from '@dtd/scene-runtime';
import {
  BackSide,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Obstacle } from './movement';

/**
 * Şehir ortamı (F6 görsel iyileştirme): gökyüzü, çevre aydınlatması, bölgeler arası zemin ve cadde, tramvay
 * rayları, ağaç/lamba süsleri, mağaza tabelaları. Sahne belgelerine (K45) dokunmaz; yalnız istemcinin
 * çizimidir. Kalıcı içerik (park, meydan) editörle sahneye girer; buradaki süsler şehir genelidir.
 */

export const SKY = { top: '#4a88cc', horizon: '#cfe0ee', ground: '#a8b3a2' } as const;

/** Kameraya bağlı, sise girmeyen renk geçişli gök kubbesi */
export function createSky(radius: number): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new Color(SKY.top) }, horizon: { value: new Color(SKY.horizon) }, ground: { value: new Color(SKY.ground) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;' +
      'void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, min(1.0, -h * 4.0));' +
      ' gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new Mesh(new SphereGeometry(radius, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/** Yumuşak stüdyo çevresi: metal/pürüzlü malzemelere gerçekçi yansıma (tek seferlik PMREM) */
export function applyEnvironment(renderer: WebGLRenderer, scene: Scene): () => void {
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  return () => env.dispose();
}

function noiseTexture(base: string, spread: number, size = 256, lines = false): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  // Belirlenimci gürültü (her açılışta aynı görünüm)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (rnd() - 0.5) * spread;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + d));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + d));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + d));
  }
  ctx.putImageData(img, 0, 0);
  if (lines) {
    // Kaldırım taşı derzleri
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let k = 0; k <= size; k += size / 4) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k, size);
      ctx.moveTo(0, k);
      ctx.lineTo(size, k);
      ctx.stroke();
    }
  }
  const t = new CanvasTexture(cv);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

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

/** Bant: a→b doğrultusunda, yanal kaydırma ve genişlikle yatay düzlem */
function band(a: V2, b: V2, offset: number, width: number, y: number, mat: MeshStandardMaterial, repeat: number): Mesh {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const geo = new PlaneGeometry(len, width).rotateX(-Math.PI / 2);
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / repeat), uv.getY(i) * (width / repeat));
  const m = new Mesh(geo, mat);
  const nx = -Math.sin(ang);
  const nz = Math.cos(ang);
  m.position.set((a[0] + b[0]) / 2 + nx * offset, y, (a[1] + b[1]) / 2 + nz * offset);
  m.rotation.y = -ang;
  m.receiveShadow = true;
  return m;
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

/**
 * Şehir geneli: zemin, paketsiz bölgelerde cadde + kaldırım, tüm hat boyunca raylar, ağaç ve lambalar.
 * Cadde ölçüleri bölge sahneleriyle aynı (cadde 14 m, kaldırım 8 m; scenes-seed).
 */
export function createCityDecor(
  bounds: { min: V2; max: V2 },
  regions: Region[],
  lines: { path: V2[]; stations: { position: [number, number, number] | null }[] }[],
  shadows: boolean,
  /** Doğuş noktası (x, z): sahnesiz bölgedeyse geçici meydan buraya kurulur */
  spawn?: V2,
): CityDecor {
  const root = new Group();
  const disposables: { dispose(): void }[] = [];
  const obstacles: Obstacle[] = [];
  const covered = regions.filter((r) => r.bundle_url);

  const grassTex = noiseTexture('#93a58a', 26);
  const asphaltTex = noiseTexture('#4a5059', 18);
  const pavingTex = noiseTexture('#c9c3b8', 14, 256, true);
  const plazaTex = noiseTexture('#b8ab97', 16, 256, true);
  plazaTex.repeat.set(9, 9);
  const grass = new MeshStandardMaterial({ map: grassTex, roughness: 1 });
  const asphalt = new MeshStandardMaterial({ map: asphaltTex, roughness: 0.92 });
  const paving = new MeshStandardMaterial({ map: pavingTex, roughness: 0.85 });
  const plazaMat = new MeshStandardMaterial({ map: plazaTex, roughness: 0.85 });
  const rail = new MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.3, metalness: 0.9 });
  disposables.push(grassTex, asphaltTex, pavingTex, plazaTex, grass, asphalt, paving, plazaMat, rail);

  // Zemin: şehrin dışına taşan çim; bölge zeminleri (y=0) bunun üstünde kalır
  const midZ = (bounds.min[1] + bounds.max[1]) / 2;
  const depth = bounds.max[1] - bounds.min[1] + 600;
  root.add(band([bounds.min[0] - 300, midZ], [bounds.max[0] + 300, midZ], 0, depth, -0.05, grass, 6));

  const stations = lines.flatMap((l) => l.stations.flatMap((s) => (s.position ? [[s.position[0], s.position[2]] as V2] : [])));
  const nearStation = (x: number, z: number) => stations.some((s) => Math.hypot(s[0] - x, s[1] - z) < 8);

  const trees: Matrix4[] = [];
  const lamps: Matrix4[] = [];
  const at = (x: number, z: number, rotY = 0, s = 1) =>
    new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotY), new Vector3(s, s, s));

  for (const line of lines) {
    for (let i = 0; i + 1 < line.path.length; i++) {
      const a = line.path[i]!;
      const b = line.path[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const nrm: V2 = [-dir[1], dir[0]];
      // Hat şehir sınırına kadar uzatılır (bölge caddeleri de sınıra kadar gider)
      const ext = 60;
      const A: V2 = [a[0] - dir[0] * ext, a[1] - dir[1] * ext];
      const B: V2 = [b[0] + dir[0] * ext, b[1] + dir[1] * ext];
      // Paketli bölge dışında kalan yerlerde cadde + iki kaldırım
      for (const [t0, t1] of uncovered(A, B, covered)) {
        const p: V2 = [A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0];
        const q: V2 = [A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1];
        root.add(band(p, q, 0, 14, 0.02, asphalt, 6), band(p, q, -11, 8, 0.05, paving, 2), band(p, q, 11, 8, 0.05, paving, 2));
      }
      // Raylar (her yerde, bölge caddelerinin üstünde): iki ray, 1,435 m açıklık
      for (const off of [-0.72, 0.72]) {
        const r = new Mesh(new BoxGeometry(len + ext * 2, 0.06, 0.08), rail);
        disposables.push(r.geometry);
        r.position.set((A[0] + B[0]) / 2 + nrm[0] * off, 0.05, (A[1] + B[1]) / 2 + nrm[1] * off);
        r.rotation.y = -Math.atan2(dir[1], dir[0]);
        r.receiveShadow = shadows;
        root.add(r);
      }
      // Süsler: kaldırım kenarında lambalar (iki yan, 18 m), dış kaldırımda ağaçlar (12 m). Mağaza önü
      // (cadde kuzeyi, panoların durduğu taraf) ağaçsız bırakılır: vitrin görünsün.
      const total = len + ext * 2;
      for (let s = 6; s < total - 6; s += 18) {
        for (const side of [-1, 1]) {
          const x = A[0] + dir[0] * s + nrm[0] * side * 7.4;
          const z = A[1] + dir[1] * s + nrm[1] * side * 7.4;
          if (nearStation(x, z)) continue;
          lamps.push(at(x, z, side > 0 ? 0 : Math.PI));
          obstacles.push({ x, z, r: 0.35 });
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
      const stone = new MeshStandardMaterial({ color: '#cfc8bb', roughness: 0.8 });
      const water = new MeshStandardMaterial({ color: '#4c8fc4', roughness: 0.08, metalness: 0.3 });
      const wood = new MeshStandardMaterial({ color: '#8a5a33', roughness: 0.8 });
      disposables.push(stone, water, wood);
      const plaza = new Mesh(new CylinderGeometry(19, 19, 0.06, 48), plazaMat);
      plaza.position.set(cx, 0.03, cz);
      plaza.receiveShadow = shadows;
      root.add(plaza);
      // Caddeye bağlanan yaya yolu
      const toStreet = nearestStreetZ(lines, cx);
      if (toStreet !== null) root.add(band([cx, toStreet + 11 * Math.sign(cz - toStreet)], [cx, cz - 19 * Math.sign(cz - toStreet)], 0, 6, 0.04, paving, 2));
      const part = (geo: CylinderGeometry | BoxGeometry, mat: MeshStandardMaterial, x: number, y: number, z: number, rotY = 0) => {
        const m = new Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.y = rotY;
        m.castShadow = shadows;
        m.receiveShadow = shadows;
        root.add(m);
      };
      part(new CylinderGeometry(4.2, 4.4, 0.7, 40), stone, cx, 0.35, cz);
      part(new CylinderGeometry(3.85, 3.85, 0.1, 40), water, cx, 0.62, cz);
      part(new CylinderGeometry(0.45, 0.6, 2.2, 16), stone, cx, 1.4, cz);
      part(new CylinderGeometry(1.4, 0.6, 0.35, 24), stone, cx, 2.5, cz);
      part(new CylinderGeometry(1.25, 1.25, 0.06, 24), water, cx, 2.66, cz);
      obstacles.push({ x: cx, z: cz, r: 4.6 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const bx = cx + Math.cos(a) * 9;
        const bz = cz + Math.sin(a) * 9;
        part(new BoxGeometry(2.2, 0.12, 0.6), wood, bx, 0.5, bz, -a + Math.PI / 2);
        part(new BoxGeometry(2.0, 0.45, 0.4), stone, bx, 0.22, bz, -a + Math.PI / 2);
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

  // Ağaç: gövde + iki taç (düşük çokgen, Kenney üslubuyla uyumlu)
  const trunkGeo = new CylinderGeometry(0.14, 0.2, 2.2, 7).translate(0, 1.1, 0);
  const crownGeo = new IcosahedronGeometry(1.5, 0).translate(0, 3.4, 0);
  const crown2Geo = new IcosahedronGeometry(1.05, 0).translate(0.5, 4.4, 0.2);
  const trunkMat = new MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.9 });
  const crownMat = new MeshStandardMaterial({ color: '#4f8a3f', roughness: 0.8, flatShading: true });
  const crown2Mat = new MeshStandardMaterial({ color: '#5f9c4a', roughness: 0.8, flatShading: true });
  // Lamba: direk + kol + armatür (kendi ışığı)
  const poleGeo = new CylinderGeometry(0.07, 0.1, 5, 8).translate(0, 2.5, 0);
  const armGeo = new BoxGeometry(0.08, 0.08, 1.3).translate(0, 4.9, 0.6);
  const headGeo = new BoxGeometry(0.34, 0.12, 0.6).translate(0, 4.84, 1.2);
  const poleMat = new MeshStandardMaterial({ color: '#2b3138', roughness: 0.5, metalness: 0.7 });
  const headMat = new MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffe7a8', emissiveIntensity: 0.8 });
  disposables.push(trunkGeo, crownGeo, crown2Geo, trunkMat, crownMat, crown2Mat, poleGeo, armGeo, headGeo, poleMat, headMat);
  const inst = (geo: BoxGeometry | CylinderGeometry | IcosahedronGeometry, mat: MeshStandardMaterial, mats: Matrix4[], cast: boolean) => {
    if (!mats.length) return;
    const m = new InstancedMesh(geo, mat, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = cast && shadows;
    m.receiveShadow = shadows;
    m.computeBoundingSphere();
    root.add(m);
  };
  inst(trunkGeo, trunkMat, trees, true);
  inst(crownGeo, crownMat, trees, true);
  inst(crown2Geo, crown2Mat, trees, true);
  inst(poleGeo, poleMat, lamps, true);
  inst(armGeo, poleMat, lamps, false);
  inst(headGeo, headMat, lamps, false);

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
 * Mağaza cephe tabelası: girişin arkasındaki binanın ön yüzüne, zemin katın üstüne. Bina, giriş noktasını
 * x ekseninde kapsayan ve girişin gerisinde kalan en yakın yüksek (≥ 3 m) model düğümüdür.
 */
export function createStoreSign(
  store: { name: string; entrance: [number, number, number] },
  buildings: Object3D[],
  color: string,
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
      geo.dispose();
      side.dispose();
      face.dispose();
      tex.dispose();
    },
  };
}
