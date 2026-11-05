/** API hatası: sunucunun { error, message } gövdesini taşır. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const GENERIC = 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.';

/** /api altındaki uçları çağırır. Çerez aynı kaynaktan gider; durum değiştiren isteklere Origin tarayıcıca eklenir. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', GENERIC);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data.error === 'string' ? data.error : 'error',
      typeof data.message === 'string' ? data.message : GENERIC,
      data,
    );
  }
  return data as T;
}
