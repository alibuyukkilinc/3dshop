import type { Quat, Vec3 } from './schema.js';

/** Y ekseni etrafında dönüş (radyan) kuaterniyonu. */
export function quatY(angle: number): Quat {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

/** X ekseni etrafında dönüş (radyan) kuaterniyonu. */
export function quatX(angle: number): Quat {
  return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** Kapalı rota üzerinde, başlangıçtan `distance` metre sonraki nokta. */
export function pointOnLoop(points: Vec3[], distance: number): Vec3 {
  const segs = points.map((p, i) => [p, points[(i + 1) % points.length]!] as const);
  const total = segs.reduce((s, [a, b]) => s + dist3(a, b), 0);
  let d = ((distance % total) + total) % total;
  for (const [a, b] of segs) {
    const len = dist3(a, b);
    if (d <= len) return lerp3(a, b, len === 0 ? 0 : d / len);
    d -= len;
  }
  return points[0]!;
}

/** Tekrarlanabilir sözde rastgele sayı üreteci (mulberry32): aynı tohum, aynı sahne. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
