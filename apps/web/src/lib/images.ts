/**
 * Kaynak sitelerin görsel CDN'i (cdn.shopyplus.com) aynı görseli boyut ekiyle sunar: _low (200 px), _medium
 * (340 px), _high (800 px). Export _high verir; vitrin kartında 1 MB'a varan dosya mobil LCP'yi bozuyordu
 * (K4, 2026-11-06 ölçümü). Bu kalıba uyan adreslerde ekrana göre küçük varyant seçilir; uymayan olduğu gibi.
 */
const HIGH = /_high\.(webp|jpe?g|png)$/i;

export interface Responsive {
  src: string;
  srcSet?: string;
}

export function responsiveImage(url: string, prefer: 'card' | 'detail' | 'thumb'): Responsive {
  if (!HIGH.test(url)) return { src: url };
  const medium = url.replace(HIGH, '_medium.$1');
  if (prefer === 'thumb') return { src: medium };
  return { src: prefer === 'card' ? medium : url, srcSet: `${medium} 340w, ${url} 800w` };
}
