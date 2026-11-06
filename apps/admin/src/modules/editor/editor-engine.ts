import { type BuiltScene, type MeshLoader, buildScene } from '@dtd/engine-three';
import type { SceneDocument } from '@dtd/scene-runtime';
import {
  ConeGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type Mode = 'translate' | 'rotate';
type V3 = [number, number, number];
type Q = [number, number, number, number];

const MARKER_COLOR: Record<string, string> = {
  slot: '#f59e0b',
  portal: '#8b5cf6',
  anchor: '#06b6d4',
};

/**
 * Şehir editörünün 3D çekirdeği (F3.4). Belge (dtd.scene.v1) tek doğrudur: sahne her yapısal değişiklikte
 * belgeden yeniden kurulur; taşıma/döndürme bitince yeni dönüşüm belgeye geri yazılır. Yuva, portal ve çapa
 * düğümleri istemcide görünmez; editörde renkli işaretle gösterilir (belgeye girmez).
 */
export class EditorEngine {
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 2000);
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private built: BuiltScene | null = null;
  private selected: string | null = null;
  private raf = 0;
  private readonly ro: ResizeObserver;
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  snap = 1;
  onSelect: (id: string | null) => void = () => undefined;
  onTransformEnd: (id: string, p: V3, r: Q) => void = () => undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly meshLoader: MeshLoader,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.camera.position.set(0, 60, 90);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 0, 0);
    this.orbit.maxPolarAngle = Math.PI / 2.05;
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setTranslationSnap(this.snap);
    this.gizmo.setRotationSnap(Math.PI / 12);
    this.gizmo.showX = true;
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
      if (!(e as unknown as { value: boolean }).value) this.emitTransform();
    });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const loop = () => {
      this.orbit.update();
      if (this.built) this.renderer.render(this.built.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Belgeden sahneyi yeniden kurar; kamera ve seçim korunur. */
  async setDocument(doc: SceneDocument): Promise<void> {
    const prev = this.built;
    this.gizmo.detach();
    const built = buildScene(doc, { shadows: true, meshLoader: this.meshLoader, autoLod: 'lod1' });
    built.scene.add(new GridHelper(400, 400 / 8, '#5b6475', '#8b93a3'));
    built.scene.add(this.gizmo.getHelper());
    for (const n of doc.nodes) {
      const marker = n.components.find(
        (c) => c.type === 'slot' || c.type === 'portal' || c.type === 'anchor',
      );
      if (marker) built.nodes.get(n.id)!.add(this.marker(marker.type));
    }
    this.built = built;
    prev?.dispose();
    if (this.selected && built.nodes.has(this.selected)) this.select(this.selected);
    else this.select(null);
    await built.ready;
  }

  select(id: string | null) {
    this.selected = id;
    const obj = id ? this.built?.nodes.get(id) : undefined;
    if (obj) this.gizmo.attach(obj);
    else this.gizmo.detach();
    this.onSelect(obj ? id : null);
  }

  setMode(mode: Mode) {
    this.gizmo.setMode(mode);
    // Döndürme yalnız dikey eksende: şehir nesneleri yere oturur
    this.gizmo.showX = mode === 'translate';
    this.gizmo.showZ = mode === 'translate';
    this.gizmo.showY = true;
  }

  setSnap(m: number) {
    this.snap = m;
    this.gizmo.setTranslationSnap(m > 0 ? m : null);
  }

  /** Ekran ortasının zemindeki karşılığı: yeni nesne buraya konur. */
  groundCenter(): V3 {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), this.camera);
    const hit = new Vector3();
    const p = ray.ray.intersectPlane(this.ground, hit) ?? this.orbit.target.clone();
    const s = this.snap || 1;
    return [Math.round(p.x / s) * s, 0, Math.round(p.z / s) * s];
  }

  focus(p: V3) {
    const delta = new Vector3(...p).sub(this.orbit.target);
    this.orbit.target.add(delta);
    this.camera.position.add(delta);
  }

  /** Çizim istatistiği (bölge paketi bütçesi, K2/K3) */
  stats() {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.gizmo.dispose();
    this.orbit.dispose();
    this.built?.dispose();
    this.renderer.dispose();
  }

  private down = { x: 0, y: 0 };
  private readonly onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };
  /** Sürükleme değil tıklamaysa: tıklanan düğümü seç (en üstteki belge düğümü) */
  private readonly onPointerUp = (e: PointerEvent) => {
    if (
      Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4 ||
      this.gizmo.dragging ||
      !this.built
    )
      return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const roots = [...this.built.nodes.values()];
    const hits = ray.intersectObjects(roots, true);
    for (const h of hits) {
      const id = this.nodeIdOf(h.object);
      // Zemin gibi büyük düzlemleri seçmek yerine üstündeki nesneyi tercih et; zemin yalnız boş tıklamada
      if (id && id !== 'zemin') return this.select(id);
    }
    this.select(null);
  };

  /** Tıklanan nesneyi taşıyan en içteki belge düğümü (alt düğüm de seçilebilsin) */
  private nodeIdOf(o: Object3D | null): string | null {
    for (let cur = o; cur; cur = cur.parent)
      if (typeof cur.userData.nodeId === 'string') return cur.userData.nodeId;
    return null;
  }

  private emitTransform() {
    const id = this.selected;
    const obj = id ? this.built?.nodes.get(id) : undefined;
    if (!id || !obj) return;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    this.onTransformEnd(
      id,
      [r3(obj.position.x), r3(obj.position.y), r3(obj.position.z)],
      [r3(obj.quaternion.x), r3(obj.quaternion.y), r3(obj.quaternion.z), r3(obj.quaternion.w)],
    );
  }

  private marker(kind: string): Object3D {
    const g = new Group();
    const mat = new MeshBasicMaterial({
      color: MARKER_COLOR[kind] ?? '#ffffff',
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const cone = new Mesh(new ConeGeometry(0.6, 1.6, 12), mat);
    cone.position.y = 2.4;
    cone.rotation.x = Math.PI;
    const ring = new Mesh(new TorusGeometry(1.2, 0.08, 6, 24), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    g.add(cone, ring);
    g.renderOrder = 10;
    return g;
  }

  private resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
