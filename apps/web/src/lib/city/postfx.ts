import { type Camera, HalfFloatType, type Object3D, type Scene, Vector2, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Son işleme (görsel iyileştirme 2, yalnız yüksek kalite): çok örnekli HDR çizim, ortam kapanması (GTAO:
 * köşe, bina dibi, raf arası gölgesi), hafif parlama (güneş, lamba, tabela), ACES tonlama ve sRGB çıkışı,
 * en sonda ince renk derecelendirme + vinyet. Orta/düşük kalitede kullanılmaz (K12: telefonda dolum yükü).
 */

/** GTAO normal/derinlik geçişinde `userData.noAO` taşıyan nesneler (gökyüzü, saydam yaprak kartları) gizlenir */
class CityGtaoPass extends GTAOPass {
  _overrideVisibility() {
    (GTAOPass.prototype as unknown as { _overrideVisibility(): void })._overrideVisibility.call(this);
    const cache = (this as unknown as { _visibilityCache: Object3D[] })._visibilityCache;
    this.scene.traverse((o) => {
      if (o.userData.noAO && o.visible) {
        o.visible = false;
        cache.push(o);
      }
    });
  }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.22 }, saturation: { value: 1.06 }, contrast: { value: 1.04 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation; uniform float contrast; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      // Hafif sıcak gölge / serin ışık ayrımı (film görünümü)
      c.rgb += vec3(0.012, 0.004, -0.010) * (1.0 - l);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly gtao: CityGtaoPass;
  private readonly bloom: UnrealBloomPass;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
  ) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.gtao = new CityGtaoPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 1.5, scale: 1.1, samples: 16 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.gtao.blendIntensity = 0.85;
    this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.16, 0.55, 0.95);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
  }

  setSize(width: number, height: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  /** Şehir ya da mağaza iç mekânı: geçişlerin sahnesi her karede güncellenir */
  render(scene: Scene, camera: Camera, dt: number) {
    if (this.renderPass.scene !== scene) {
      this.renderPass.scene = scene;
      this.gtao.scene = scene;
    }
    this.renderPass.camera = camera;
    this.gtao.camera = camera;
    this.composer.render(dt);
  }

  dispose() {
    this.gtao.dispose();
    this.bloom.dispose();
    this.composer.dispose();
  }
}
