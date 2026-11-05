import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, api } from './api';

/** GET ucunu yükler; reload ile yeniler. Hata metni sunucudan gelir. */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Veri alınamadı.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Yazım isteği: meşgul durumu ve sunucu hatası tek yerde. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true);
    setError(null);
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İşlem başarısız.');
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: () => setError(null) };
}

/** Hash yönlendirici: #/sources gibi. Sunucu tarafında yönlendirme gerektirmez (statik panel). */
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
export function useRoute(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, '') || '/');
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'hiç';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} sa önce` : `${Math.round(h / 24)} gün önce`;
}
