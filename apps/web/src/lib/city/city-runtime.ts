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
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { type CityDecor, createCityDecor, createStoreSign } from './environment';
import { type Interior, type InteriorData, buildInterior } from './interior';
import { type Obstacle, type V2, rideAt, step } from './movement';
import { PostFx } from './postfx';
import type { QualitySettings } from './quality';
import { SKY, SUN_DIR, bakeSkyEnvironment, createSkyDome } from './sky';
import { type AtlasCache, type SurfaceKit, createAtlasCache, createSurfaceKit, enhanceRegion } from './surfaces';

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

export interface StoreRef {
  id: string;
  slug: string;
  name: string;
  entrance: [number, number, number];
}

export interface CityCallbacks {
  onProduct(productId: string): void;
  /** Giriş kapısına yakın mağaza (≈ 12 m) ya da null */
  onNearStore?(store: StoreRef | null): void;
  /** İç mekâna girildi (veri) / çıkıldı (null) / yükleniyor (true) */
  onInterior?(state: InteriorData | null | 'loading'): void;
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
  private readonly sky: ReturnType<typeof createSkyDome>;
  private readonly decor: CityDecor;
  private readonly envMap: Texture;
  private readonly kit: SurfaceKit;
  private readonly atlas: AtlasCache;
  private post: PostFx | null = null;
  private clock = 0;
  private interior: { built: Interior; store: StoreRef; color: string } | null = null;
  private entering = false;
  private nearStore: StoreRef | null = null;
  /** Mağaza → binadan dışa doğru birim yön (çıkışta oyuncu kapının önüne konur) ve tabela rengi */
  private readonly storeInfo = new Map<string, { out: V2; color: string }>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly manifest: Manifest,
    private settings: QualitySettings,
    private readonly cb: CityCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: settings.dpr > 1, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = PCFShadowMap;
    // Film tonlaması: güneşli sahnede patlayan beyazlar yumuşar, renkler doygun kalır
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Çizim istatistiği kare başına toplanır (son işlemenin ara geçişleri dahil; stats())
    this.renderer.info.autoReset = false;
    // Gerçekçi gökyüzü + ondan pişirilen çevre ışığı: gölgedeki yüzler gökyüzü mavisini, camlar bulutları yansıtır
    this.envMap = bakeSkyEnvironment(this.renderer);
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.9;
    this.sky = createSkyDome();
    this.scene.add(this.sky.mesh);
    // Çevre haritası ortam ışığını büyük ölçüde verir; yarıküre yalnız yerden sekme sıcaklığı için
    this.scene.add(new HemisphereLight('#d4e3f5', '#8a7d68', 0.35));
    this.sun = new DirectionalLight('#fff0d6', 3.0);
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    Object.assign(this.sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 220 });
    this.scene.add(this.sun, this.sun.target);
    this.pos = [manifest.spawn[0], manifest.spawn[2]];
    const xs = manifest.regions.flatMap((r) => r.polygon.map((p) => p[0]));
    const zs = manifest.regions.flatMap((r) => r.polygon.map((p) => p[1]));
    this.bounds = xs.length ? { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] } : { min: [-200, -120], max: [200, 120] };
    this.tram = this.makeTram();
    this.scene.add(this.tram);
    this.kit = createSurfaceKit();
    this.atlas = createAtlasCache();
    this.decor = createCityDecor(this.bounds, manifest.regions, manifest.transit_lines, this.kit, { shadows: settings.shadows, skyline: settings.skyline }, [
      manifest.spawn[0],
      manifest.spawn[2],
    ]);
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
    // Hava perspektifi: sis ufuk rengine birleşir; uzak silüet binaları pusa gömülür
    this.scene.fog = new Fog(SKY.horizon, s.fog * 0.5, s.fog);
    this.camera.far = s.fog + 20;
    // Gök kubbesi görüş uzaklığının hemen içinde (kameraya bağlı, sise girmez)
    this.sky.mesh.scale.setScalar(s.fog + 5);
    this.camera.updateProjectionMatrix();
    if (s.post && !this.post) {
      this.post = new PostFx(this.renderer, this.scene, this.camera);
      this.resize();
    } else if (!s.post && this.post) {
      this.post.dispose();
      this.post = null;
    }
  }

  /** Şehir ya da iç mekân karesi: yüksek kalitede son işlemeden geçer */
  private draw(scene: Scene, dt: number) {
    this.renderer.info.reset();
    if (this.post) this.post.render(scene, this.camera, dt);
    else this.renderer.render(scene, this.camera);
  }

  /** Dokunmatik joystick girdisi (−1…1) */
  setJoystick(forward: number, strafe: number) {
    this.joy.forward = forward;
    this.joy.strafe = strafe;
  }

  /** Hızlı seyahat (K04): noktaya ışınla, verilen hedefe bak. */
  teleport(x: number, z: number, lookAt?: [number, number]) {
    if (this.interior) this.exitStore();
    this.ride = null;
    this.cb.onRide(false);
    this.pos = [x, z];
    if (lookAt) this.yaw = Math.atan2(-(lookAt[0] - x), -(lookAt[1] - z));
    void this.stream();
    this.checkStores(false);
  }

  /** En yakın duraktan hedef durağa tramvayla git */
  rideTo(target: [number, number, number]) {
    if (this.interior) this.exitStore();
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
    this.interior?.built.dispose();
    this.decor.dispose();
    this.post?.dispose();
    this.sky.dispose();
    this.kit.dispose();
    this.atlas.dispose();
    this.envMap.dispose();
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
      if (this.disposed) return;
      // Düz renkli cadde/kaldırım/zemin dokulu yüzey olur, model camları gökyüzünü yansıtır
      const prims = doc.nodes.filter((n) => n.components.some((c) => c.type === 'primitive')).flatMap((n) => built.nodes.get(n.id) ?? []);
      enhanceRegion(root, prims, this.kit, this.atlas);
      this.addObstacles(built, doc, bundle.stores);
      this.addStoreSigns(entry, built, doc, bundle);
      this.checkStores(false);
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
      const color = SIGN_COLORS[hash % SIGN_COLORS.length]!;
      const sign = createStoreSign(st, buildings, color);
      // Dışa yön: tabela (bina cephesi) → giriş; tabela yoksa +z
      const out: V2 = sign ? norm([st.entrance[0] - sign.mesh.position.x, st.entrance[2] - sign.mesh.position.z]) : [0, 1];
      this.storeInfo.set(st.slug, { out, color });
      if (!sign) continue;
      entry.root.add(sign.mesh);
      entry.extras.push(sign);
    }
  }

  /** Bina tabanları (yüksekliği ≥ 3 m varlıklar) yürüme engeli olur. */
  private addObstacles(built: BuiltScene, doc: SceneDocument, stores: StoreRef[]) {
    const box = new Box3();
    for (const n of doc.nodes) {
      if (!n.components.some((c) => c.type === 'mesh')) continue;
      const obj = built.nodes.get(n.id);
      if (!obj) continue;
      box.setFromObject(obj);
      const size = box.getSize(new Vector3());
      if (size.y < 3) continue;
      const c = box.getCenter(new Vector3());
      const r = Math.max(size.x, size.z) * 0.45;
      // İçinde mağaza girişi kalan engel (tente, saçak) yürümeyi engellemez: kapıya ulaşılabilmeli
      if (stores.some((st) => Math.hypot(st.entrance[0] - c.x, st.entrance[2] - c.z) < r + 0.5)) continue;
      this.obstacles.push({ x: c.x, z: c.z, r });
    }
  }

  // ------------------------------------------------------------------ döngü

  private readonly loop = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.interior) {
      this.interiorFrame(dt);
      this.sampleFps(now);
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
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
      if (before[0] !== this.pos[0] || before[1] !== this.pos[1]) {
        this.maybeStream();
        this.checkStores();
      }
      this.animateTram(dt);
    }
    this.camera.position.set(this.pos[0], this.debugEye, this.pos[1]);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.sky.mesh.position.copy(this.camera.position);
    this.clock += dt;
    this.sky.tick(this.clock);
    // Gölge kamerası oyuncunun 15 m önüne odaklanır: bakılan yerde gölge çözünürlüğü yüksek kalır.
    // Adım gölge dokusu pikseline yuvarlanır: yürürken gölge kenarları titremez.
    const snap = 110 / 2048;
    const fx = Math.round((this.pos[0] - Math.sin(this.yaw) * 15) / snap) * snap;
    const fz = Math.round((this.pos[1] - Math.cos(this.yaw) * 15) / snap) * snap;
    this.sun.position.set(fx + SUN_DIR.x * 110, SUN_DIR.y * 110, fz + SUN_DIR.z * 110);
    this.sun.target.position.set(fx, 0, fz);
    this.draw(this.scene, dt);
    this.sampleFps(now);
    this.raf = requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------------ mağaza iç mekânı (K64)

  /** Yüklü paketlerdeki mağazalar */
  private stores(): StoreRef[] {
    return [...this.regions.values()].flatMap((r) => r.bundle?.stores ?? []);
  }

  /** autoEnter: yürüyerek kapıya gelindiyse içeri (ışınlanma/yüklemede değil) */
  private checkStores(autoEnter = true) {
    let best: StoreRef | null = null;
    let bestD = 12;
    for (const st of this.stores()) {
      const d = Math.hypot(st.entrance[0] - this.pos[0], st.entrance[2] - this.pos[1]);
      if (d < bestD) [best, bestD] = [st, d];
    }
    if (best?.slug !== this.nearStore?.slug) {
      this.nearStore = best;
      this.cb.onNearStore?.(best);
    }
    // Kapıya yürüyünce içeri
    if (autoEnter && best && bestD < 1.3) void this.enterStore(best.slug);
  }

  /** Mağazaya gir: iç mekân verisi yüklenir, iç mekân sahnesi kurulur, oyuncu kapının içine konur. */
  async enterStore(slug: string) {
    if (this.interior || this.entering) return;
    const store = this.stores().find((s) => s.slug === slug);
    if (!store) return;
    this.entering = true;
    this.cb.onInterior?.('loading');
    try {
      const res = await fetch(`/api/v1/stores/${slug}/interior`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as InteriorData;
      if (this.disposed) return;
      const color = this.storeInfo.get(slug)?.color ?? SIGN_COLORS[0]!;
      const built = buildInterior(data, { environment: this.scene.environment, accent: color });
      this.interior = { built, store, color };
      const sp = built.layout.spawn;
      this.pos = [sp.x, sp.z];
      this.yaw = sp.yaw;
      this.pitch = -0.05;
      this.cb.onInterior?.(data);
    } catch {
      this.cb.onInterior?.(null);
    } finally {
      this.entering = false;
    }
  }

  /** Mağazadan çık: iç mekân bırakılır, oyuncu kapının önüne, caddeye bakarak konur. */
  exitStore() {
    if (!this.interior) return;
    const { built, store } = this.interior;
    this.interior = null;
    built.dispose();
    const out = this.storeInfo.get(store.slug)?.out ?? [0, 1];
    // Vitrin panolarının (girişten ≈ 4 m) önüne
    this.pos = [store.entrance[0] + out[0] * 5.5, store.entrance[2] + out[1] * 5.5];
    this.yaw = Math.atan2(-out[0], -out[1]);
    this.pitch = -0.08;
    this.nearStore = null;
    this.cb.onInterior?.(null);
  }

  private interiorFrame(dt: number) {
    const it = this.interior!;
    const L = it.built.layout;
    const k = (a: string, b: string) => (this.keys.has(a) || this.keys.has(b) ? 1 : 0);
    const forward = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + this.joy.forward;
    const strafe = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + this.joy.strafe;
    // İçeride daha yavaş yürünür (raflar yakın)
    this.pos = step(this.pos, this.yaw, { forward, strafe }, dt, { speed: this.keys.has('ShiftLeft') ? WALK * 1.4 : WALK * 0.7, bounds: L.bounds, obstacles: L.obstacles });
    if (this.pos[1] > L.exit.minZ && this.pos[0] > L.exit.minX && this.pos[0] < L.exit.maxX && forward + strafe !== 0) {
      this.exitStore();
      return;
    }
    it.built.update(this.pos[0], this.pos[1]);
    this.camera.position.set(this.pos[0], 1.6, this.pos[1]);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.draw(it.built.scene, dt);
  }

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
    if (this.interior) {
      ray.far = 14;
      const hit = ray.intersectObjects(this.interior.built.pickables, true)[0];
      const pid = hit ? this.interior.built.productAt(hit.object, hit.uv) : null;
      if (pid) this.cb.onProduct(pid);
      return;
    }
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
    this.post?.setSize(w, h);
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

function norm(v: V2): V2 {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-6 ? [0, 1] : [v[0] / l, v[1] / l];
}
