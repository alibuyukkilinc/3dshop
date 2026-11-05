/**
 * Kaynak site devre kesicisi (entegrasyon: hata yönetimi). Art arda OPEN_AFTER başarısız çalışmadan sonra site
 * bekletilir; her yeni hatada bekleme ikiye katlanır, en çok MAX_OPEN_MS. Başarılı çalışma sayacı sıfırlar.
 */
export const OPEN_AFTER = 3;
export const BASE_OPEN_MS = 5 * 60_000;
export const MAX_OPEN_MS = 2 * 3_600_000;

export function nextCircuitState(failures: number, now: Date): { consecutiveFailures: number; circuitOpenUntil: Date | null } {
  const consecutiveFailures = failures + 1;
  if (consecutiveFailures < OPEN_AFTER) return { consecutiveFailures, circuitOpenUntil: null };
  const wait = Math.min(BASE_OPEN_MS * 2 ** (consecutiveFailures - OPEN_AFTER), MAX_OPEN_MS);
  return { consecutiveFailures, circuitOpenUntil: new Date(now.getTime() + wait) };
}

export function isCircuitOpen(openUntil: Date | null, now: Date): boolean {
  return openUntil !== null && openUntil.getTime() > now.getTime();
}
