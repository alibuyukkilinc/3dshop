/**
 * Gece uzlaştırma saati (K42). Türkiye saatiyle 04:30: gece yedeği 03:15'te (F0.7), kaynak sitelerin gece
 * işleri ve kur güncellemesi bundan önce biter; ziyaretçi trafiği en düşük.
 * Türkiye 2016'dan beri yaz saati uygulamıyor, sabit UTC+3.
 */
export const RECONCILE_HOUR = 4;
export const RECONCILE_MINUTE = 30;
const TR_OFFSET_MS = 3 * 3_600_000;

/** now anına göre en son geçmiş uzlaştırma anı (UTC Date). */
export function lastReconcileAt(now: Date): Date {
  const local = new Date(now.getTime() + TR_OFFSET_MS);
  const todayAt = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), RECONCILE_HOUR, RECONCILE_MINUTE) - TR_OFFSET_MS;
  return new Date(todayAt <= now.getTime() ? todayAt : todayAt - 24 * 3_600_000);
}
