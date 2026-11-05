import { EticaretExportPageSchema } from '../domain/eticaret/export-schema.js';

export interface ExportPageQuery {
  updatedSince?: string | null;
  cursor: number;
  limit: number;
}

export interface ExportPage {
  items: unknown[];
  nextCursor: number;
  hasMore: boolean;
}

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'SourceHttpError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 30_000;
/** Kaynağın üst sınırı 250; 100 sayfa başına ~150–550 ms ölçüldü (eticaret kartı X862YZ) */
export const EXPORT_PAGE_LIMIT = 100;

/**
 * eticaret API v2 istemcisi. Token products.public_read kapsamlıdır: yanıtta buy_price hiç yoktur; olsa da
 * şema okumaz (K41). Token ve yanıt gövdesi hata mesajına ya da loga yazılmaz.
 */
export class EticaretClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async exportPage(q: ExportPageQuery): Promise<ExportPage> {
    const url = new URL('/api/v2/admin/products/export', this.baseUrl);
    url.searchParams.set('cursor', String(q.cursor));
    url.searchParams.set('limit', String(q.limit));
    // Arşivlenen ürünler gelmez; aynadan düşmeleri tam eşitlemede "kaynakta yok" olarak işlenir
    url.searchParams.set('is_archived', '0');
    if (q.updatedSince) url.searchParams.set('updated_since', q.updatedSince);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', 'User-Agent': 'dtd-integration/1' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new SourceHttpError(`Kaynağa ulaşılamadı: ${(e as Error).name}`, null);
    }
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? ' (token geçersiz ya da kapsamı yetersiz)' : '';
      throw new SourceHttpError(`Kaynak HTTP ${res.status}${hint}`, res.status);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new SourceHttpError('Kaynak yanıtı JSON değil', res.status);
    }
    const parsed = EticaretExportPageSchema.safeParse(body);
    if (!parsed.success) throw new SourceHttpError('Kaynak yanıtı beklenen biçimde değil', res.status);
    return { items: parsed.data.data.items, nextCursor: parsed.data.data.next_cursor, hasMore: parsed.data.data.has_more };
  }
}
