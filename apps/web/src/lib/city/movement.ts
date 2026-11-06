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
