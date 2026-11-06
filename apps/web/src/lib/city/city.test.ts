import { describe, expect, it } from 'vitest';
import { type TramBox, brakingSpeed, clearanceAhead, pushOutOfBox, rideAt, step } from './movement';
import { degrade, guessQuality } from './quality';

describe('kalite profili (K12)', () => {
  it('cihaza göre tahmin', () => {
    expect(guessQuality({ mobile: true, deviceMemory: 4, hardwareConcurrency: 8 })).toBe('medium');
    expect(guessQuality({ mobile: false, deviceMemory: 8, hardwareConcurrency: 8 })).toBe('high');
    expect(guessQuality({ mobile: true, deviceMemory: 2 })).toBe('low');
    expect(guessQuality({ mobile: false, saveData: true })).toBe('low');
  });
  it('FPS düşükse bir alt profil; low ve <20 FPS ise 2D önerisi', () => {
    expect(degrade('high', 22)).toEqual({ quality: 'medium', suggest2d: false });
    expect(degrade('low', 15)).toEqual({ quality: 'low', suggest2d: true });
    expect(degrade('medium', 45)).toEqual({ quality: 'medium', suggest2d: false });
  });
});

describe('yürüme ve tramvay (K04)', () => {
  const opts = { speed: 4, bounds: { min: [-200, -120] as [number, number], max: [200, 120] as [number, number] }, obstacles: [] };
  it('ileri −Z yönüne gider; sınır aşılmaz', () => {
    const p = step([0, 0], 0, { forward: 1, strafe: 0 }, 1, opts);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(-4);
    expect(step([199, 0], -Math.PI / 2, { forward: 1, strafe: 0 }, 10, opts)[0]).toBe(200);
  });
  it('çapraz hız normalize; engel içine girilmez', () => {
    const p = step([0, 0], 0, { forward: 1, strafe: 1 }, 1, opts);
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(4);
    const q = step([0, 3], 0, { forward: 1, strafe: 0 }, 1, { ...opts, obstacles: [{ x: 0, z: 0, r: 2 }] });
    expect(Math.hypot(q[0], q[1])).toBeGreaterThanOrEqual(2.4 - 1e-9);
  });
  it('tramvay sabit hızla gider ve durakta biter', () => {
    expect(rideAt([-100, 20], [0, 20], 10, 5)).toEqual({ pos: [-50, 20], done: false });
    expect(rideAt([-100, 20], [0, 20], 10, 20)).toEqual({ pos: [0, 20], done: true });
  });
});

describe('tramvay oyuncunun içinden geçmez', () => {
  // x ekseni boyunca hat, merkez 0,0: gövde x −13,5…13,5, z −1,35…1,35
  const box: TramBox = { x: 0, z: 0, dirX: 1, dirZ: 0, halfL: 13.5, halfW: 1.35 };

  it('gövdeye yandan girilmez: en yakın kenara itilir', () => {
    expect(pushOutOfBox([5, 1], box)).toEqual([5, 1.75]);
    expect(pushOutOfBox([5, -0.2], box)).toEqual([5, -1.75]);
    expect(pushOutOfBox([13.6, 0], box)).toEqual([13.9, 0]);
    expect(pushOutOfBox([5, 3], box)).toEqual([5, 3]);
  });

  it('önündeki boşluk: koridorda ve öndeyse ölçülür; yanda/arkada sonsuz', () => {
    expect(clearanceAhead([24, 0.5], box, 1)).toBeCloseTo(10.1);
    expect(clearanceAhead([24, 0.5], box, -1)).toBe(Infinity);
    expect(clearanceAhead([24, 3], box, 1)).toBe(Infinity);
    expect(clearanceAhead([0, 1.75], box, 1)).toBe(Infinity);
  });

  it('fren: boşluk durma payına inince hız sıfır', () => {
    expect(brakingSpeed(Infinity, 3.5, 1.5)).toBe(Infinity);
    expect(brakingSpeed(1.5, 3.5, 1.5)).toBe(0);
    expect(brakingSpeed(13.07, 3.5, 1.5)).toBeCloseTo(9, 1);
  });
});
