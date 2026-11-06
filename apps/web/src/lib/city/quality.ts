/**
 * Uyarlamalı kalite (K12): cihaz ve bağlantıya göre profil. WebGL yoksa 3D açılmaz, 2D'ye düşülür.
 * Profil açılışta tahmin edilir, sonra ölçülen FPS'e göre düşürülür (yükseltilmez: titreşim olmasın).
 */
export type Quality = 'low' | 'medium' | 'high';

export interface QualitySettings {
  dpr: number;
  shadows: boolean;
  lod: 'lod0' | 'lod1' | 'lod2';
  /** Bu uzaklıktan (m) ötedeki bölge paketleri yüklenmez */
  streamRadius: number;
  fog: number;
}

export const SETTINGS: Record<Quality, QualitySettings> = {
  low: { dpr: 1, shadows: false, lod: 'lod2', streamRadius: 140, fog: 160 },
  medium: { dpr: 1.5, shadows: false, lod: 'lod1', streamRadius: 220, fog: 260 },
  high: { dpr: 2, shadows: true, lod: 'lod0', streamRadius: 320, fog: 400 },
};

export interface DeviceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
  effectiveType?: string;
  mobile: boolean;
}

export function guessQuality(h: DeviceHints): Quality {
  if (h.saveData || h.effectiveType === '2g' || h.effectiveType === 'slow-2g') return 'low';
  const mem = h.deviceMemory ?? 4;
  const cores = h.hardwareConcurrency ?? 4;
  if (mem <= 2 || cores <= 2) return 'low';
  if (h.mobile || mem <= 4 || h.effectiveType === '3g') return 'medium';
  return 'high';
}

/** Ölçülen ortalama FPS'e göre bir alt profil (K2: ≥30 ortalama). low'da da 20 altıysa 2D önerilir. */
export function degrade(q: Quality, avgFps: number): { quality: Quality; suggest2d: boolean } {
  if (avgFps >= 28) return { quality: q, suggest2d: false };
  if (q === 'high') return { quality: 'medium', suggest2d: false };
  if (q === 'medium') return { quality: 'low', suggest2d: false };
  return { quality: 'low', suggest2d: avgFps < 20 };
}

export function webglAvailable(doc: Document = document): boolean {
  try {
    const c = doc.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
