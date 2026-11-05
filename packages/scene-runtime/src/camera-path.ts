import { lerp3 } from './math.js';
import type { Vec3 } from './schema.js';

/** Ölçüm rotası: güney kaldırımdan yürür, Esen Solar'a bakar, Deneme Kapsülü'nün içine girer, raflara bakar. */
interface Key {
  t: number;
  pos: Vec3;
  target: Vec3;
}

export const BENCH_DURATION_S = 20;

const KEYS: Key[] = [
  { t: 0, pos: [-55, 1.7, 5], target: [-40, 1.7, 0] },
  { t: 4, pos: [-30, 1.7, 4], target: [-20, 3, -16] },
  { t: 8, pos: [-5, 1.7, 3], target: [10, 2, -6] },
  { t: 11, pos: [15, 1.7, 0], target: [22, 2.5, -14] },
  { t: 14, pos: [22, 1.7, -10], target: [22, 2.4, -20] },
  { t: 17, pos: [18, 1.7, -14], target: [26, 2.4, -20] },
  { t: 20, pos: [28, 1.7, -8], target: [40, 3, 0] },
];

const smooth = (x: number) => x * x * (3 - 2 * x);

/** t saniyedeki kamera konumu ve baktığı nokta. */
export function cameraAt(t: number): { pos: Vec3; target: Vec3 } {
  const clamped = Math.max(0, Math.min(BENCH_DURATION_S, t));
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    if (clamped <= b.t) {
      const k = smooth((clamped - a.t) / (b.t - a.t));
      return { pos: lerp3(a.pos, b.pos, k), target: lerp3(a.target, b.target, k) };
    }
  }
  const last = KEYS[KEYS.length - 1]!;
  return { pos: last.pos, target: last.target };
}
