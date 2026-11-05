import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { BOARD_TEXTURE_PX, type Component, type Material, type SceneDocument, buildTestScene, drawBoard, pointOnLoop } from '@dtd/scene-runtime';
import { Bench, readOptions } from './bench';

/** Babylon.js adaptörü: dtd.scene.v1 belgesini Babylon nesnelerine çevirir (K20, K45). */
const opts = readOptions();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const t0 = performance.now();

const engine = new Engine(canvas, true, { powerPreference: 'high-performance', stencil: true }, false);
engine.setHardwareScalingLevel(1 / opts.dpr);

const { doc } = buildTestScene();
const scene = new Scene(engine);
scene.useRightHandedSystem = true; // belge sağ el sistemli (three ile aynı)
const camera = new FreeCamera('kamera', new Vector3(0, 1.7, 0), scene);
camera.fov = (60 * Math.PI) / 180;
camera.minZ = 0.1;
camera.maxZ = 400;
const instr = new SceneInstrumentation(scene);
instr.captureFrameTime = false;
const movers: { node: TransformNode; points: [number, number, number][]; speed: number }[] = [];
const casters: Mesh[] = [];
let shadowGen: ShadowGenerator | null = null;

const hex = (h: string) => Color3.FromHexString(h).toLinearSpace();

function build(doc: SceneDocument) {
  scene.clearColor = Color4.FromHexString(`${doc.background}ff`);
  const byId = new Map<string, TransformNode>();
  const materials = new Map<string, PBRMetallicRoughnessMaterial>();
  const material = (m: Material) => {
    const key = JSON.stringify(m);
    let mm = materials.get(key);
    if (!mm) {
      mm = new PBRMetallicRoughnessMaterial(key, scene);
      mm.baseColor = hex(m.color);
      mm.roughness = m.roughness;
      mm.metallic = m.metalness;
      if (m.emissive) mm.emissiveColor = hex(m.emissive);
      materials.set(key, mm);
    }
    return mm;
  };

  for (const node of doc.nodes) {
    const t = new TransformNode(node.name ?? node.id, scene);
    t.position = new Vector3(...node.transform.p);
    t.rotationQuaternion = new Quaternion(...node.transform.r);
    t.scaling = new Vector3(...node.transform.s);
    if (node.parent) t.parent = byId.get(node.parent)!;
    byId.set(node.id, t);
    for (const c of node.components) addComponent(t, c, material);
  }
  if (shadowGen) for (const m of casters) shadowGen.addShadowCaster(m, false);
}

function addComponent(t: TransformNode, c: Component, material: (m: Material) => PBRMetallicRoughnessMaterial) {
  switch (c.type) {
    case 'primitive': {
      const [a = 1, b = 1, d = 1] = c.size;
      const mesh =
        c.shape === 'box'
          ? CreateBox('k', { width: a, height: b, depth: d }, scene)
          : c.shape === 'plane'
            ? CreateGround('z', { width: a, height: b }, scene)
            : c.shape === 'cylinder'
              ? CreateCylinder('s', { diameter: a, height: b, tessellation: 16 }, scene)
              : CreateSphere('k', { diameter: a, segments: 12 }, scene);
      mesh.material = material(c.material);
      mesh.parent = t;
      mesh.receiveShadows = c.receiveShadow && opts.shadows;
      if (c.castShadow) casters.push(mesh);
      break;
    }
    case 'board': {
      const tex = new DynamicTexture('pano', { width: BOARD_TEXTURE_PX.w, height: BOARD_TEXTURE_PX.h }, scene, true);
      drawBoard(tex.getContext() as unknown as CanvasRenderingContext2D, BOARD_TEXTURE_PX.w, BOARD_TEXTURE_PX.h, c);
      tex.update(true);
      tex.anisotropicFilteringLevel = 4;
      const mat = new PBRMetallicRoughnessMaterial('pano', scene);
      mat.baseTexture = tex;
      mat.roughness = 0.6;
      mat.metallic = 0;
      const mesh = CreatePlane('pano', { width: c.width, height: c.height, sideOrientation: Mesh.DOUBLESIDE }, scene);
      mesh.material = mat;
      mesh.parent = t;
      mesh.receiveShadows = opts.shadows;
      break;
    }
    case 'light': {
      if (c.kind === 'hemispheric') {
        const l = new HemisphericLight('gök', new Vector3(0, 1, 0), scene);
        l.diffuse = hex(c.color);
        l.groundColor = hex('#6b6455');
        l.intensity = c.intensity;
      } else {
        const dir = new Vector3(...(c.direction ?? [0, -1, 0])).normalize();
        const l = new DirectionalLight('güneş', dir, scene);
        l.position = dir.scale(-60);
        l.diffuse = hex(c.color);
        l.intensity = c.intensity * 1.6;
        if (c.shadows && opts.shadows) {
          l.shadowMinZ = 1;
          l.shadowMaxZ = 160;
          l.orthoLeft = -70;
          l.orthoRight = 70;
          l.orthoTop = 70;
          l.orthoBottom = -70;
          l.autoUpdateExtends = false;
          shadowGen = new ShadowGenerator(2048, l);
          shadowGen.usePercentageCloserFiltering = true;
          shadowGen.bias = 0.0005;
        }
      }
      break;
    }
    case 'path_loop':
      movers.push({ node: t, points: c.points, speed: c.speed });
      break;
    default:
      break;
  }
}

build(doc);
const target = new Vector3();
const bench = new Bench(
  {
    engine: 'Babylon.js',
    version: Engine.Version,
    setFrame(t, cam) {
      for (const m of movers) m.node.position.set(...pointOnLoop(m.points, t * m.speed));
      camera.position.set(...cam.pos);
      camera.setTarget(target.set(...cam.target));
    },
    stats: () => ({ drawCalls: instr.drawCallsCounter.current, triangles: Math.round(scene.getActiveIndices() / 3) }),
    gl: () => engine._gl,
  },
  opts,
  performance.now() - t0,
);

addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => {
  bench.beforeRender(performance.now());
  scene.render();
});
