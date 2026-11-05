import { BOARD_TEXTURE_PX, type Component, type Material, type SceneDocument, buildTestScene, drawBoard, pointOnLoop } from '@dtd/scene-runtime';
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
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  REVISION,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Bench, readOptions } from './bench';

/** Three.js adaptörü: dtd.scene.v1 belgesini Three.js nesnelerine çevirir (K20, K45). */
const opts = readOptions();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const t0 = performance.now();

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(opts.dpr);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = opts.shadows;
renderer.shadowMap.type = PCFSoftShadowMap;

const { doc } = buildTestScene();
const scene = new Scene();
const camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
const movers: { obj: Object3D; points: [number, number, number][]; speed: number }[] = [];

function build(doc: SceneDocument) {
  scene.background = new Color(doc.background);
  const byId = new Map<string, Object3D>();
  const materials = new Map<string, MeshStandardMaterial>();
  const material = (m: Material) => {
    const key = JSON.stringify(m);
    let mm = materials.get(key);
    if (!mm) {
      mm = new MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness });
      if (m.emissive) mm.emissive = new Color(m.emissive);
      materials.set(key, mm);
    }
    return mm;
  };

  for (const node of doc.nodes) {
    const g = new Group();
    g.name = node.name ?? node.id;
    g.position.set(...node.transform.p);
    g.quaternion.set(...node.transform.r);
    g.scale.set(...node.transform.s);
    (node.parent ? byId.get(node.parent)! : scene).add(g);
    byId.set(node.id, g);
    for (const c of node.components) addComponent(g, c, material);
  }
}

function addComponent(g: Group, c: Component, material: (m: Material) => MeshStandardMaterial) {
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
      const mesh = new Mesh(geo, material(c.material));
      mesh.castShadow = c.castShadow;
      mesh.receiveShadow = c.receiveShadow;
      g.add(mesh);
      break;
    }
    case 'board': {
      const cv = document.createElement('canvas');
      cv.width = BOARD_TEXTURE_PX.w;
      cv.height = BOARD_TEXTURE_PX.h;
      drawBoard(cv.getContext('2d')!, cv.width, cv.height, c);
      const tex = new CanvasTexture(cv);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new Mesh(
        new PlaneGeometry(c.width, c.height),
        new MeshStandardMaterial({ map: tex, roughness: 0.6, side: DoubleSide }),
      );
      mesh.receiveShadow = true;
      g.add(mesh);
      break;
    }
    case 'light': {
      if (c.kind === 'hemispheric') {
        g.add(new HemisphereLight(c.color, '#6b6455', c.intensity * 1.5));
      } else {
        const dir = new Vector3(...(c.direction ?? [0, -1, 0])).normalize();
        const light = new DirectionalLight(c.color, c.intensity * 2);
        light.position.copy(dir.clone().multiplyScalar(-60));
        light.castShadow = c.shadows && opts.shadows;
        light.shadow.mapSize.set(2048, 2048);
        Object.assign(light.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 160 });
        light.shadow.bias = -0.0005;
        g.add(light, light.target);
      }
      break;
    }
    case 'path_loop':
      movers.push({ obj: g, points: c.points, speed: c.speed });
      break;
    default:
      break; // mesh (F3), slot, portal: prototipte çizilmez
  }
}

build(doc);
const bench = new Bench(
  {
    engine: 'Three.js',
    version: `r${REVISION}`,
    setFrame(t, cam) {
      for (const m of movers) m.obj.position.set(...pointOnLoop(m.points, t * m.speed));
      camera.position.set(...cam.pos);
      camera.lookAt(...cam.target);
    },
    stats: () => ({ drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    gl: () => renderer.getContext(),
  },
  opts,
  performance.now() - t0,
);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

renderer.setAnimationLoop((now) => {
  bench.beforeRender(now);
  renderer.render(scene, camera);
});
