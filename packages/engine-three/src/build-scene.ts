import {
  BOARD_TEXTURE_PX,
  type Component,
  type Material,
  type SceneDocument,
  SceneDocumentSchema,
  drawBoard,
  pointOnLoop,
} from '@dtd/scene-runtime';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  type Texture,
  Vector3,
} from 'three';

/**
 * dtd.scene.v1 → Three.js sahne grafiği (K45, K63). Belge her motor için aynıdır; burası yalnız çevirir.
 * Render, kamera ve döngü burada değil (view.ts): böylece bu kısım WebGL olmadan test edilebilir.
 */
export interface BuildOptions {
  shadows: boolean;
  /** Pano dokusu üreticisi; varsayılanı tarayıcıda tuval kullanır (testte değiştirilir) */
  boardTexture?: (board: { title: string; price_text: string; color: string }) => Texture;
}

export interface BuiltScene {
  scene: Scene;
  /** Belge düğüm kimliği → nesne */
  nodes: Map<string, Object3D>;
  /** Zamanla hareket eden düğümler (tramvay) */
  update(timeS: number): void;
  dispose(): void;
}

function canvasBoardTexture(board: { title: string; price_text: string; color: string }): Texture {
  const cv = document.createElement('canvas');
  cv.width = BOARD_TEXTURE_PX.w;
  cv.height = BOARD_TEXTURE_PX.h;
  drawBoard(cv.getContext('2d')!, cv.width, cv.height, board);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildScene(input: SceneDocument, opts: BuildOptions): BuiltScene {
  const doc = SceneDocumentSchema.parse(input);
  const scene = new Scene();
  scene.background = new Color(doc.background);
  const nodes = new Map<string, Object3D>();
  const materials = new Map<string, MeshStandardMaterial>();
  const disposables: { dispose(): void }[] = [];
  const movers: { obj: Object3D; points: [number, number, number][]; speed: number }[] = [];
  const boardTexture = opts.boardTexture ?? canvasBoardTexture;

  const material = (m: Material) => {
    const key = JSON.stringify(m);
    let mm = materials.get(key);
    if (!mm) {
      mm = new MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness });
      if (m.emissive) mm.emissive = new Color(m.emissive);
      materials.set(key, mm);
      disposables.push(mm);
    }
    return mm;
  };

  const add = (g: Group, c: Component) => {
    switch (c.type) {
      case 'primitive': {
        const [a = 1, b = 1, d = 1] = c.size;
        const geo =
          c.shape === 'box'
            ? new BoxGeometry(a, b, d)
            : c.shape === 'plane'
              ? new PlaneGeometry(a, b).rotateX(-Math.PI / 2)
              : c.shape === 'cylinder'
                ? new CylinderGeometry(a / 2, a / 2, b, 16)
                : new SphereGeometry(a / 2, 16, 12);
        disposables.push(geo);
        const mesh = new Mesh(geo, material(c.material));
        mesh.castShadow = c.castShadow && opts.shadows;
        mesh.receiveShadow = c.receiveShadow && opts.shadows;
        g.add(mesh);
        return;
      }
      case 'board': {
        const tex = boardTexture(c);
        const geo = new PlaneGeometry(c.width, c.height);
        const mat = new MeshStandardMaterial({ map: tex, roughness: 0.6, side: DoubleSide });
        disposables.push(tex, geo, mat);
        const mesh = new Mesh(geo, mat);
        mesh.receiveShadow = opts.shadows;
        mesh.userData.productId = c.product_id;
        g.add(mesh);
        return;
      }
      case 'light': {
        if (c.kind === 'hemispheric') {
          g.add(new HemisphereLight(c.color, '#6b6455', c.intensity * 1.5));
          return;
        }
        const dir = new Vector3(...(c.direction ?? [0, -1, 0])).normalize();
        const light = new DirectionalLight(c.color, c.intensity * 2);
        light.position.copy(dir.clone().multiplyScalar(-60));
        light.castShadow = c.shadows && opts.shadows;
        light.shadow.mapSize.set(2048, 2048);
        Object.assign(light.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 160 });
        light.shadow.bias = -0.0005;
        g.add(light, light.target);
        return;
      }
      case 'path_loop':
        movers.push({ obj: g, points: c.points, speed: c.speed });
        return;
      case 'mesh':
      case 'slot':
      case 'portal':
      case 'anchor':
        // mesh: varlık kütüphanesi (F3); slot/portal/çapa görünmez işaretlerdir
        g.userData[c.type] = c;
        return;
    }
  };

  for (const node of doc.nodes) {
    const g = new Group();
    g.name = node.name ?? node.id;
    g.userData.nodeId = node.id;
    g.position.set(...node.transform.p);
    g.quaternion.set(...node.transform.r);
    g.scale.set(...node.transform.s);
    (node.parent ? nodes.get(node.parent)! : scene).add(g);
    nodes.set(node.id, g);
    for (const c of node.components) add(g, c);
  }

  return {
    scene,
    nodes,
    update(timeS) {
      for (const m of movers) m.obj.position.set(...pointOnLoop(m.points, timeS * m.speed));
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
