/**
 * Bölge paketi biçimi (K48): istemci bölgeye girince yalnız bunu indirir; veritabanına dokunmaz. İçerik
 * adresli (sha256) ve değişmez. Fiyat/stok paketteki değerlerle başlar, canlı katmandan (live/prices) tazelenir.
 */
export interface RegionBundle {
  schema: 'dtd.region-bundle.v1';
  world: { slug: string; name: string };
  region: { id: string; slug: string; name: string; polygon: [number, number][] };
  scene: { id: string; version_id: string; number: number };
  /** dtd.scene.v1; yuvalara ürün panosu düğümleri eklenmiş hâli */
  document: { schema: 'dtd.scene.v1'; units: 'm'; background: string; nodes: BundleNode[] };
  /** varlık sürümü → LOD dosya adresleri */
  assets: Record<string, { lod0?: string; lod1?: string; lod2?: string }>;
  stores: { id: string; slug: string; name: string; entrance: V3 }[];
  stations: { place_id: string; name: string; position: V3 }[];
  boards: { node_id: string; slot_id: string; store_id: string; product_id: string; position: V3 }[];
  built_at: string;
}

export type V3 = [number, number, number];
export interface BundleNode {
  id: string;
  parent: string | null;
  name?: string;
  transform: { p: V3; r: [number, number, number, number]; s: V3 };
  components: Record<string, unknown>[];
}

/** Vitrin yuvasını en yakın mağaza girişine bağlar (eşik metre); yakında giriş yoksa yuva boş kalır. */
export function nearestStore(slot: V3, entrances: { id: string; entrance: V3 }[], maxM = 20): string | null {
  let best: { id: string; d: number } | null = null;
  for (const e of entrances) {
    const d = Math.hypot(slot[0] - e.entrance[0], slot[2] - e.entrance[2]);
    if (d <= maxM && (!best || d < best.d)) best = { id: e.id, d };
  }
  return best?.id ?? null;
}

/** Pano başlığında fiyat (kuruş → "14.708,90 TL"); kesin değer canlı katmandan. */
export function priceText(minor: number | null | undefined, currency = 'TRY'): string {
  if (minor === null || minor === undefined) return '';
  const whole = Math.floor(minor / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${whole},${String(minor % 100).padStart(2, '0')} ${currency === 'TRY' ? 'TL' : currency}`;
}
