/** Büyük daire uzaklığı (km). Pilotta PostGIS yerine (K40 sapması, F3.1): şube sayısı küçük. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Sanal konumun hücresi (bölge akışının birimi, K40): floor(x / boyut). */
export function cellOf(x: number, z: number, cellSizeM: number): { cellX: number; cellZ: number } {
  return { cellX: Math.floor(x / cellSizeM), cellZ: Math.floor(z / cellSizeM) };
}

/** Türkiye kara sınırının kaba dikdörtgeni: elle girilen konumda bariz hatayı yakalar. */
export function insideTurkeyBox(lat: number, lng: number): boolean {
  return lat >= 35.8 && lat <= 42.2 && lng >= 25.6 && lng <= 44.9;
}
