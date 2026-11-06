import { describe, expect, it } from 'vitest';
import { type LaneCar, advanceLane } from './traffic';

const run = (cars: LaneCar[], seconds: number, length: number, stopAt: number | null) => {
  for (let t = 0; t < seconds; t += 0.05) advanceLane(cars, 0.05, length, stopAt);
};

describe('cadde trafiği (görsel iyileştirme 3)', () => {
  it('serbest yolda istenen hıza çıkar ve şerit sonunda başa döner', () => {
    const car: LaneCar = { s: 0, v: 0, cruise: 10 };
    run([car], 20, 100, null);
    expect(car.v).toBeCloseTo(10, 1);
    expect(car.s).toBeGreaterThanOrEqual(0);
    expect(car.s).toBeLessThan(100);
  });

  it('öndeki duran araca çarpmaz, arada mesafe kalır', () => {
    const lead: LaneCar = { s: 60, v: 0, cruise: 0 };
    const car: LaneCar = { s: 0, v: 12, cruise: 12 };
    run([lead, car], 15, 1000, null);
    expect(lead.s - car.s).toBeGreaterThan(7);
    expect(car.v).toBeLessThan(0.5);
  });

  it('yoldaki yayanın önünde durur', () => {
    const car: LaneCar = { s: 0, v: 11, cruise: 11 };
    run([car], 15, 1000, 50);
    expect(car.s).toBeLessThan(50);
    expect(car.v).toBeLessThan(0.5);
  });
});
