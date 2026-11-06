import type { SceneDocument, Vec3 } from '@dtd/scene-runtime';
import { PCFShadowMap, PerspectiveCamera, WebGLRenderer } from 'three';
import { type BuiltScene, buildScene } from './build-scene.js';
import type { Lod, MeshLoader } from './mesh-loader.js';

/**
 * Tarayıcı görünümü: tuval, renderer, kamera ve döngü (K63). Kalite profili K12'ye göre dışarıdan verilir.
 * F4'te yürüme/çarpışma, bölge akışı (K48) ve 2D'ye düşme bu katmanın üzerine eklenir.
 */
export interface ViewOptions {
  shadows: boolean;
  /** Piksel oranı üst sınırı (düşük cihazda 1) */
  maxDpr: number;
  meshLoader?: MeshLoader;
  autoLod?: Lod;
}

export interface ViewStats {
  drawCalls: number;
  triangles: number;
}

export interface SceneView {
  built: BuiltScene;
  setCamera(pos: Vec3, target: Vec3): void;
  /** Her karede çağrılır: zamanı uygular ve çizer */
  frame(timeS: number): void;
  stats(): ViewStats;
  gl(): WebGL2RenderingContext | WebGLRenderingContext;
  resize(): void;
  dispose(): void;
}

export function createSceneView(canvas: HTMLCanvasElement, doc: SceneDocument, opts: ViewOptions): SceneView {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr));
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = PCFShadowMap;
  const camera = new PerspectiveCamera(60, 1, 0.1, 400);
  const built = buildScene(doc, { shadows: opts.shadows, meshLoader: opts.meshLoader, autoLod: opts.autoLod });

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    built,
    setCamera(pos, target) {
      camera.position.set(...pos);
      camera.lookAt(...target);
    },
    frame(timeS) {
      built.update(timeS);
      renderer.render(built.scene, camera);
    },
    stats: () => ({ drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    gl: () => renderer.getContext(),
    resize,
    dispose() {
      built.dispose();
      renderer.dispose();
    },
  };
}
