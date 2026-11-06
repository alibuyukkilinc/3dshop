import { type BuiltScene, buildScene, createGltfMeshLoader } from '@dtd/engine-three';
import type { SceneDocument } from '@dtd/scene-runtime';
import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { type CityDecor, SKY, applyEnvironment, createCityDecor, createSky, createStoreSign } from './environment';
import { type Obstacle, type V2, rideAt, step } from './movement';
import type { QualitySettings } from './quality';

export interface Manifest {
  world: { slug: string; name: string };
  spawn: [number, number, number];
  regions: { id: string; slug: string; name: string; polygon: [number, number][]; bundle_url: string | null }[];
  transit_lines: { code: string; name: string; path: [number, number][]; stations: { place_id: string; name: string; position: [number, number, number] | null }[] }[];
}

export interface Bundle {
  region: { slug: string; name: string; polygon: [number, number][] };
  document: SceneDocument;
  assets: Record<string, { lod0?: string; lod1?: string; lod2?: string }>;
  stores: { id: string; slug: string; name: string; entrance: [number, number, number] }[];
  boards: { node_id: string; product_id: string; store_id: string }[];
}

export interface CityCallbacks {
  onProduct(productId: string): void;
  onRegion(name: string | null): void;
  onFps(avg: number): void;
  onBundles(loaded: Bundle[]): void;
  onRide(active: boolean): void;
}

const EYE = 1.7;
const WALK = 4.2;
const TRAM_SPEED = 9;
/** Mağaza tabelası renkleri (sırayla; mağaza kimliğinden seçilir, her açılışta aynı) */
const SIGN_COLORS = ['#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#047857'];

/** 3D şehir istemcisi (F4.2): bölge akışı, yürüme, tramvay, ürün panosu seçimi. Motor: Three.js (K63). */
export class CityRuntime {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(65, 1, 0.1, 600);
  private readonly sun: DirectionalLight;
  private readonly regions = new Map<string, { built: BuiltScene | null; root: Group; bundle: Bundle | null; loading: boolean; extras: { dispose(): void }[] }>();
  private readonly obstacles: Obstacle[] = [];
  private readonly loader;
  private readonly keys = new Set<string>();
  private readonly joy = { forward: 0, strafe: 0 };
  private pos: V2;
  private yaw = 0;
  private pitch = -0.08;
  private last = performance.now();
  private raf = 0;
  private fpsFrames = 0;
  private fpsStart = performance.now();
  private tram: Group;
  private tramT = 0;
  private ride: { from: V2; to: V2; t: number } | null = null;
  private currentRegion: string | null = null;
  private readonly bounds: { min: V2; max: V2 };
  private disposed = false;
  private readonly sky: Mesh;
  private readonly decor: CityDecor;
  private readonly disposeEnv: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly manifest: Manifest,
    private settings: QualitySettings,
    private readonly cb: CityCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: settings.dpr > 1, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Film tonlaması: güneşli sahnede patlayan beyazlar yumuşar, renkler doygun kalır
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.disposeEnv = applyEnvironment(this.renderer, this.scene);
    this.sky = createSky(1);
    this.scene.add(this.sky);
    this.scene.add(new HemisphereLight('#dceaf7', '#8b8070', 0.8));
    this.sun = new DirectionalLight('#fff3dc', 2.2);
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    Object.assign(this.sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
    this.scene.add(this.sun, this.sun.target);
    this.pos = [manifest.spawn[0], manifest.spawn[2]];
    const xs = manifest.regions.flatMap((r) => r.polygon.map((p) => p[0]));
    const zs = manifest.regions.flatMap((r) => r.polygon.map((p) => p[1]));
    this.bounds = xs.length ? { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] } : { min: [-200, -120], max: [200, 120] };
    this.tram = this.makeTram();
    this.scene.add(this.tram);
    this.decor = createCityDecor(this.bounds, manifest.regions, manifest.transit_lines, settings.shadows, [manifest.spawn[0], manifest.spawn[2]]);
    this.scene.add(this.decor.root);
    this.obstacles.push(...this.decor.obstacles);
    this.applySettings(settings);
    // Varlık adresi: hangi bölgenin paketinde varsa oradan
    this.loader = createGltfMeshLoader(async (versionId, lod) => {
      for (const r of this.regions.values()) {
        const a = r.bundle?.assets[versionId];
        if (a) return a[lod] ?? a.lod1 ?? a.lod0 ?? null;
      }
      return null;
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.loop);
    void this.stream();
  }

  applySettings(s: QualitySettings) {
    this.settings = s;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.dpr));
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.castShadow = s.shadows;
    this.scene.fog = new Fog(SKY.horizon, s.fog * 0.55, s.fog);
    this.camera.far = s.fog + 20;
    // Gök kubbesi görüş uzaklığının hemen içinde (kameraya bağlı, sise girmez)
    this.sky.scale.setScalar(s.fog + 5);
    this.camera.updateProjectionMatrix();
  }

  /** Dokunmatik joystick girdisi (−1…1) */
  setJoystick(forward: number, strafe: number) {
    this.joy.forward = forward;
    this.joy.strafe = strafe;
  }

  /** Hızlı seyahat (K04): noktaya ışınla, verilen hedefe bak. */
  teleport(x: number, z: number, lookAt?: [number, number]) {
    this.ride = null;
    this.cb.onRide(false);
    this.pos = [x, z];
    if (lookAt) this.yaw = Math.atan2(-(lookAt[0] - x), -(lookAt[1] - z));
    void this.stream();
  }

  /** En yakın duraktan hedef durağa tramvayla git */
  rideTo(target: [number, number, number]) {
    const stations = this.manifest.transit_lines.flatMap((l) => l.stations).filter((s) => s.position);
    if (!stations.length) return;
    const nearest = stations.reduce((a, b) =>
      Math.hypot(a.position![0] - this.pos[0], a.position![2] - this.pos[1]) < Math.hypot(b.position![0] - this.pos[0], b.position![2] - this.pos[1]) ? a : b,
    );
    this.ride = { from: [nearest.position![0], nearest.position![2]], to: [target[0], target[2]], t: 0 };
    this.yaw = target[0] > nearest.position![0] ? -Math.PI / 2 : Math.PI / 2;
    this.cb.onRide(true);
  }

  /** Geliştirme/ekran görüntüsü: kamerayı bir noktaya ve açıya koyar (y: göz yüksekliği yerine). */
  debugView(x: number, z: number, yaw: number, pitch: number, y = EYE) {
    this.debugEye = y;
    this.pos = [x, z];
    this.yaw = yaw;
    this.pitch = pitch;
    void this.stream();
  }
  private debugEye = EYE;

  stats() {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('resize', this.resize);
    for (const r of this.regions.values()) {
      r.built?.dispose();
      for (const d of r.extras) d.dispose();
    }
    this.decor.dispose();
    this.disposeEnv();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ bölge akışı (K48)

  private async stream() {
    const near: string[] = [];
    for (const r of this.manifest.regions) {
      if (!r.bundle_url) continue;
      const d = distToPolygonBox(this.pos, r.polygon);
      const entry = this.regions.get(r.slug);
      if (d <= this.settings.streamRadius) {
        near.push(r.slug);
        if (!entry) void this.loadRegion(r.slug, r.bundle_url);
      } else if (entry && !entry.loading && d > this.settings.streamRadius * 1.5) {
        this.scene.remove(entry.root);
        entry.built?.dispose();
        for (const d of entry.extras) d.dispose();
        this.regions.delete(r.slug);
      }
    }
    // Bölge değişimi: alt bilgi için
    const inside = this.manifest.regions.find((r) => distToPolygonBox(this.pos, r.polygon) === 0);
    const name = inside?.name ?? null;
    if (name !== this.currentRegion) {
      this.currentRegion = name;
      this.cb.onRegion(name);
    }
  }

  private async loadRegion(slug: string, url: string) {
    const root = new Group();
    const entry = { built: null as BuiltScene | null, root, bundle: null as Bundle | null, loading: true, extras: [] as { dispose(): void }[] };
    this.regions.set(slug, entry);
    try {
      const bundle = (await (await fetch(url)).json()) as Bundle;
      if (this.disposed) return;
      entry.bundle = bundle;
      // Işıklar şehir genelinde bir kez: bölge belgelerindeki ışık düğümleri atlanır
      const doc = { ...bundle.document, nodes: bundle.document.nodes.filter((n) => !n.components.some((c) => c.type === 'light')) };
      const built = buildScene(doc, { shadows: this.settings.shadows, meshLoader: this.loader, autoLod: this.settings.lod });
      entry.built = built;
      for (const child of [...built.scene.children]) root.add(child);
      this.scene.add(root);
      this.cb.onBundles([...this.regions.values()].flatMap((r) => (r.bundle ? [r.bundle] : [])));
      await built.ready;
      this.addObstacles(built, doc);
      this.addStoreSigns(entry, built, doc, bundle);
    } catch {
      this.regions.delete(slug);
    } finally {
      entry.loading = false;
    }
  }

  /** Mağaza adı tabelaları: girişin arkasındaki binanın cephesine (paketteki mağaza listesinden). */
  private addStoreSigns(entry: { root: Group; extras: { dispose(): void }[] }, built: BuiltScene, doc: SceneDocument, bundle: Bundle) {
    const buildings = doc.nodes.filter((n) => n.components.some((c) => c.type === 'mesh')).flatMap((n) => built.nodes.get(n.id) ?? []);
    for (const st of bundle.stores) {
      const hash = [...st.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 0);
      const sign = createStoreSign(st, buildings, SIGN_COLORS[hash % SIGN_COLORS.length]!);
      if (!sign) continue;
      entry.root.add(sign.mesh);
      entry.extras.push(sign);
    }
  }

  /** Bina tabanları (yüksekliği ≥ 3 m varlıklar) yürüme engeli olur. */
  private addObstacles(built: BuiltScene, doc: SceneDocument) {
    const box = new Box3();
    for (const n of doc.nodes) {
      if (!n.components.some((c) => c.type === 'mesh')) continue;
      const obj = built.nodes.get(n.id);
      if (!obj) continue;
      box.setFromObject(obj);
      const size = box.getSize(new Vector3());
      if (size.y < 3) continue;
      const c = box.getCenter(new Vector3());
      this.obstacles.push({ x: c.x, z: c.z, r: Math.max(size.x, size.z) * 0.45 });
    }
  }

  // ------------------------------------------------------------------ döngü

  private readonly loop = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.ride) {
      this.ride.t += dt;
      const r = rideAt(this.ride.from, this.ride.to, TRAM_SPEED, this.ride.t);
      this.pos = r.pos;
      this.tram.position.set(r.pos[0], 0, r.pos[1] - 2.2);
      if (r.done) {
        this.ride = null;
        this.cb.onRide(false);
        void this.stream();
      }
    } else {
      const k = (a: string, b: string) => (this.keys.has(a) || this.keys.has(b) ? 1 : 0);
      const forward = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + this.joy.forward;
      const strafe = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + this.joy.strafe;
      const before = this.pos;
      this.pos = step(this.pos, this.yaw, { forward, strafe }, dt, { speed: this.keys.has('ShiftLeft') ? WALK * 2 : WALK, bounds: this.bounds, obstacles: this.obstacles });
      if (before[0] !== this.pos[0] || before[1] !== this.pos[1]) this.maybeStream();
      this.animateTram(dt);
    }
    this.camera.position.set(this.pos[0], this.debugEye, this.pos[1]);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.sky.position.copy(this.camera.position);
    this.sun.position.set(this.pos[0] + 45, 70, this.pos[1] + 35);
    this.sun.target.position.set(this.pos[0], 0, this.pos[1]);
    this.renderer.render(this.scene, this.camera);
    this.sampleFps(now);
    this.raf = requestAnimationFrame(this.loop);
  };

  private streamAt = 0;
  private maybeStream() {
    const t = performance.now();
    if (t - this.streamAt > 800) {
      this.streamAt = t;
      void this.stream();
    }
  }

  private animateTram(dt: number) {
    const line = this.manifest.transit_lines[0];
    if (!line || line.path.length < 2) return;
    const [a, b] = [line.path[0]!, line.path[line.path.length - 1]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.tramT = (this.tramT + dt * TRAM_SPEED) % (len * 2);
    const d = this.tramT < len ? this.tramT : len * 2 - this.tramT;
    this.tram.position.set(a[0] + ((b[0] - a[0]) * d) / len, 0, a[1] + ((b[1] - a[1]) * d) / len - 2.2);
  }

  private sampleFps(now: number) {
    this.fpsFrames++;
    if (now - this.fpsStart >= 5000) {
      this.cb.onFps((this.fpsFrames * 1000) / (now - this.fpsStart));
      this.fpsFrames = 0;
      this.fpsStart = now;
    }
  }

  // ------------------------------------------------------------------ girdi

  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest('input, textarea, select, button')) return;
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  private drag: { x: number; y: number; id: number; moved: boolean } | null = null;
  private readonly onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  };
  private readonly onMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
    this.yaw -= dx * 0.004;
    this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch - dy * 0.003));
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
  };
  private readonly onUp = (e: PointerEvent) => {
    if (this.drag && !this.drag.moved && e.pointerId === this.drag.id) this.pick(e.clientX, e.clientY);
    this.drag = null;
  };

  /** Dokunulan ürün panosu (userData.productId taşır) */
  private pick(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    ray.far = 40;
    for (const h of ray.intersectObjects([...this.regions.values()].map((r) => r.root), true)) {
      const pid = findProduct(h.object);
      if (pid) return this.cb.onProduct(pid);
    }
  }

  /** Tramvay: beyaz gövde, renk şeridi, koyu camlar, çatı ekipmanı (iki çizim çağrısı başına parça) */
  private makeTram(): Group {
    const g = new Group();
    const part = (w: number, h: number, d: number, color: string, y: number, extra: Partial<{ roughness: number; metalness: number; x: number }> = {}) => {
      const m = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color, roughness: extra.roughness ?? 0.5, metalness: extra.metalness ?? 0.1 }));
      m.position.set(extra.x ?? 0, y, 0);
      m.castShadow = true;
      g.add(m);
    };
    part(12, 2.7, 2.6, '#f3f4f1', 1.75);
    part(12.04, 0.32, 2.64, '#0f766e', 0.62);
    part(12.04, 0.12, 2.64, '#0f766e', 3.02);
    part(11.4, 1.05, 2.66, '#1e2a35', 2.25, { roughness: 0.15, metalness: 0.6 });
    part(12.3, 0.22, 2.4, '#d6d8d4', 3.2);
    part(2.2, 0.3, 1.2, '#4b5563', 3.45, { x: -2 });
    // Ön/arka farlar
    for (const x of [-6.03, 6.03]) part(0.06, 0.25, 2.0, '#fff7d6', 0.95, { x });
    return g;
  }

  private readonly resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

function findProduct(o: Object3D | null): string | null {
  for (let cur = o; cur; cur = cur.parent) if (typeof cur.userData.productId === 'string') return cur.userData.productId;
  return null;
}

function distToPolygonBox(p: V2, poly: [number, number][]): number {
  if (!poly.length) return Infinity;
  const xs = poly.map((q) => q[0]);
  const zs = poly.map((q) => q[1]);
  const dx = Math.max(Math.min(...xs) - p[0], 0, p[0] - Math.max(...xs));
  const dz = Math.max(Math.min(...zs) - p[1], 0, p[1] - Math.max(...zs));
  return Math.hypot(dx, dz);
}
