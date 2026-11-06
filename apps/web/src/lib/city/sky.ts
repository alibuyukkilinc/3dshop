import { BackSide, Color, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, type Texture, Vector3, type WebGLRenderer } from 'three';

/**
 * Gerçekçi gökyüzü (görsel iyileştirme 2): yükseklikle koyulaşan mavi, ufukta pus, güneş diski ve halesi,
 * yavaş kayan katmanlı bulutlar. Aynı gölgelendirici çevre haritasına da pişirilir: binalar, camlar ve
 * metal yüzeyler bu gökyüzünü yansıtır, gölgedeki yüzler gökyüzünün mavisini alır (stüdyo ışığı yerine).
 * Yalnız istemci çizimidir; sahne belgesine (K45) yazılmaz.
 */

/** Güneş yönü (sahneden güneşe): batı-güneybatıdan ≈ 38° yükseklik; gölgeler caddeye uzun düşer */
export const SUN_DIR = new Vector3(0.62, 0.62, 0.48).normalize();

export const SKY = {
  zenith: '#2a62ad',
  horizon: '#b9cde0',
  ground: '#8d948a',
  sun: '#fff1d6',
} as const;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float time;
uniform float sunDisk;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = max(dot(d, sunDir), 0.0);
  vec3 col;
  if (h >= 0.0) {
    // Gök: ufukta açık ve puslu, tepede koyu mavi; güneş tarafı daha aydınlık
    float t = pow(h, 0.42);
    col = mix(horizon, zenith, t);
    col += sunColor * (0.10 * pow(mu, 4.0) + 0.35 * pow(mu, 64.0)) * (1.0 - t * 0.5);
    // Bulutlar: düz bir bulut tavanına iz düşüm, iki katmanlı fbm, rüzgârla kayar
    vec2 uv = d.xz / (h + 0.06) * 0.55 + vec2(time * 0.004, time * 0.0015);
    float n = fbm(uv * 1.6);
    float cover = smoothstep(0.50, 0.78, n);
    // Güneşe doğru örnekle: bulut kalınlığı → alt yüz gölgesi
    float n2 = fbm(uv * 1.6 + sunDir.xz * 0.08);
    float shade = clamp(0.55 + (n - n2) * 3.0, 0.25, 1.0);
    vec3 cloud = mix(vec3(0.58, 0.63, 0.70), vec3(1.02, 1.0, 0.97), shade);
    cloud += sunColor * pow(mu, 8.0) * 0.6 * cover;
    float fade = smoothstep(0.0, 0.18, h);
    col = mix(col, cloud, cover * fade * 0.92);
    // Ufuk pusu (sis rengine birleşir)
    col = mix(col, horizon, pow(1.0 - h, 10.0) * 0.85);
    // Güneş diski
    col += sunColor * sunDisk * smoothstep(0.99955, 0.99985, mu) * (1.0 - cover * fade);
  } else {
    // Ufkun altı: zemin rengi (yalnız çevre haritasında ve şehir dışında görünür)
    col = mix(horizon, ground, min(1.0, -h * 5.0));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function skyMaterial(sunDisk: number): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new Color(SKY.zenith) },
      horizon: { value: new Color(SKY.horizon) },
      ground: { value: new Color(SKY.ground) },
      sunColor: { value: new Color(SKY.sun) },
      sunDir: { value: SUN_DIR.clone() },
      time: { value: 0 },
      sunDisk: { value: sunDisk },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

/** Kameraya bağlı gök kubbesi; `tick(t)` bulutları kaydırır */
export function createSkyDome(): { mesh: Mesh; tick(timeS: number): void; dispose(): void } {
  const mat = skyMaterial(18);
  const geo = new SphereGeometry(1, 48, 24);
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  // Ortam kapanması (AO) geçişi gökyüzünü çizmesin
  mesh.userData.noAO = true;
  return {
    mesh,
    tick(t) {
      mat.uniforms.time!.value = t;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Gökyüzünü çevre haritasına pişirir (PMREM, tek sefer). Güneş diski düşük tutulur: aynalı yüzeylerde
 * patlamasın, parlak noktayı doğrudan güneş ışığı zaten verir.
 */
export function bakeSkyEnvironment(renderer: WebGLRenderer): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const scene = new Scene();
  const mat = skyMaterial(4);
  const geo = new SphereGeometry(50, 48, 24);
  scene.add(new Mesh(geo, mat));
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return env;
}
