/**
 * Süreç içi basit hız sınırı (kayan pencere). Pilotta tek API süreci var; Redis gelince (F0.6) paylaşımlı
 * sınırlayıcıya taşınır. Hesap kilidi ayrıca veritabanında tutulur (asıl koruma).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** true: izin verildi. */
  take(key: string, now = Date.now()): boolean {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.prune(from);
    return true;
  }

  private prune(from: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
  }
}
