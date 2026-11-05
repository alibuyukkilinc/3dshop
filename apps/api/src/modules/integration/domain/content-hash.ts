import { createHash } from 'node:crypto';
import type { ProductV1 } from '@dtd/contracts';

/**
 * Ürünün içerik özeti: değişmeyen ürün yeniden yazılmaz, olay üretilmez (idempotency, K42).
 * source.updated_at dışarıda bırakılır: kaynak zamanı değişip içerik aynı kaldıysa aynada değişiklik yoktur.
 */
export function productContentHash(product: ProductV1): string {
  const { source, ...content } = product;
  // Seçenek sırası kaynakta eşit main_sort değerlerinde kararsız olabilir: özet sırasız hesaplanır,
  // gösterim sırası ilk yazılan hâliyle kalır
  const variants = [...content.variants].sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
  const basis = { site: source.site, external_id: source.external_id, content: { ...content, variants } };
  return `sha256:${createHash('sha256').update(stableStringify(basis), 'utf8').digest('hex')}`;
}

/** Anahtar sırasından bağımsız JSON. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
