import { BufferGeometry, Color, Float32BufferAttribute, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { SETTINGS } from './quality';
import { applyWorldUv, classifySurface } from './surfaces';

describe('yüzey sınıflandırma (görsel iyileştirme 2)', () => {
  it('bölge sahnesi renkleri: cadde asfalt, kaldırım parke, zemin plak, yeşil çim', () => {
    expect(classifySurface(new Color('#4b5563'))).toBe('asphalt');
    expect(classifySurface(new Color('#d6d3d1'))).toBe('paver');
    expect(classifySurface(new Color('#9aa39a'))).toBe('slab');
    expect(classifySurface(new Color('#5f9c4a'))).toBe('grass');
  });

  it('dünya UV: komşu yüzeyler dikişsiz (aynı noktada aynı UV, ölçek türe göre)', () => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 6, 0, -12], 3));
    geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 0, 0], 2));
    applyWorldUv(geo, new Matrix4().makeTranslation(6, 0, 0), 'asphalt');
    const uv = geo.getAttribute('uv');
    expect([uv.getX(0), uv.getY(0)]).toEqual([1, -0]);
    expect([uv.getX(1), uv.getY(1)]).toEqual([2, 2]);
  });

  it('son işleme yalnız yüksek kalitede (K12)', () => {
    expect([SETTINGS.low.post, SETTINGS.medium.post, SETTINGS.high.post]).toEqual([false, false, true]);
  });
});
