/**
 * Yürüme (K04): yön girdisi (ileri/yan, −1…1) ve bakış açısıyla yeni konum. Şehir sınırının dışına
 * çıkılmaz; binaların içine girmeyi engelleyen basit daire çarpışması (bina tabanı yarıçapı).
 */
export type V2 = [number, number];

export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

export function step(
  pos: V2,
  yaw: number,
  input: { forward: number; strafe: number },
  dt: number,
  opts: { speed: number; bounds: { min: V2; max: V2 }; obstacles: Obstacle[]; radius?: number },
): V2 {
  const len = Math.hypot(input.forward, input.strafe);
  if (len === 0 || dt <= 0) return pos;
  const f = input.forward / Math.max(1, len);
  const s = input.strafe / Math.max(1, len);
  // Three.js: kamera −Z'ye bakar; yaw Y ekseni etrafında
  const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * opts.speed * dt;
  const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * opts.speed * dt;
  let [x, z] = [pos[0] + dx, pos[1] + dz];
  x = Math.min(opts.bounds.max[0], Math.max(opts.bounds.min[0], x));
  z = Math.min(opts.bounds.max[1], Math.max(opts.bounds.min[1], z));
  const me = opts.radius ?? 0.4;
  for (const o of opts.obstacles) {
    const d = Math.hypot(x - o.x, z - o.z);
    const min = o.r + me;
    if (d < min) {
      // Engelin kenarına it (kaydırarak geçmeye izin verir)
      const k = d === 0 ? 1 : min / d;
      x = o.x + (x - o.x) * k;
      z = o.z + (z - o.z) * k;
    }
  }
  return [x, z];
}

/** Tramvay hattı üzerinde a→b yolculuğu: t saniyede konum (sabit hız). */
export function rideAt(from: V2, to: V2, speed: number, t: number): { pos: V2; done: boolean } {
  const total = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const d = Math.min(total, speed * t);
  const k = total === 0 ? 1 : d / total;
  return { pos: [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k], done: d >= total };
}

/**
 * Tramvay gövdesi (yönlü dikdörtgen): merkez, hat yönü (birim vektör), yarı boy ve yarı en. Tramvay oyuncunun
 * içinden geçmez: önünde oyuncu varsa fren yapar, yandan gövdeye yürünemez.
 */
export interface TramBox {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  halfL: number;
  halfW: number;
}

function toLocal(pos: V2, b: TramBox): { u: number; v: number } {
  const dx = pos[0] - b.x;
  const dz = pos[1] - b.z;
  return { u: dx * b.dirX + dz * b.dirZ, v: -dx * b.dirZ + dz * b.dirX };
}

/** Oyuncuyu gövdenin dışına, en kısa yönden iter (yan ise yana, burun ise öne) */
export function pushOutOfBox(pos: V2, b: TramBox, radius = 0.4): V2 {
  const { u, v } = toLocal(pos, b);
  const eu = b.halfL + radius;
  const ev = b.halfW + radius;
  if (Math.abs(u) >= eu || Math.abs(v) >= ev) return pos;
  let [nu, nv] = [u, v];
  if (ev - Math.abs(v) <= eu - Math.abs(u)) nv = (v < 0 ? -1 : 1) * ev;
  else nu = (u < 0 ? -1 : 1) * eu;
  return [b.x + nu * b.dirX - nv * b.dirZ, b.z + nu * b.dirZ + nv * b.dirX];
}

/**
 * Hareket yönünde (travel: hat yönüne göre +1/−1) burun ile oyuncu arasındaki boşluk (m). Oyuncu ray
 * koridorunda değilse, yanında ya da arkasındaysa Infinity.
 */
export function clearanceAhead(pos: V2, b: TramBox, travel: 1 | -1, radius = 0.4, margin = 0.6): number {
  const { u, v } = toLocal(pos, b);
  if (Math.abs(v) > b.halfW + radius + margin) return Infinity;
  const gap = travel * u - b.halfL - radius;
  return gap < -0.05 ? Infinity : Math.max(0, gap);
}

/** Frenle sınırlanmış hız: boşluk içinde (stopGap kadar önde) durabileceği en yüksek hız */
export function brakingSpeed(gap: number, decel: number, stopGap: number): number {
  return gap === Infinity ? Infinity : Math.sqrt(2 * decel * Math.max(0, gap - stopGap));
}
