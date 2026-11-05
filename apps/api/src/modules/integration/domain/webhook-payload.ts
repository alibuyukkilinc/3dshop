import { z } from 'zod';

/** Kaynak e-ticaret olayları (B2, K53). */
export const WEBHOOK_EVENTS = [
  'product.changed',
  'price.changed',
  'stock.changed',
  'option_stock.changed',
  'product.deleted',
  'order.created',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const ProductId = z.union([z.number().int().positive(), z.string().regex(/^\d{1,12}$/)]).transform(String);

/**
 * Gövde: {"event", "site", "product_ids": [...], "order": {...}}. Ürün verisi gövdede taşınmaz/kullanılmaz:
 * webhook yalnız tetikleyicidir, doğru veri export'tan çekilir (K42). order.created kişisel veri taşımaz (K53).
 */
export const WebhookBodySchema = z.object({
  event: z.enum(WEBHOOK_EVENTS),
  site: z.string().min(1).max(40),
  product_ids: z.array(ProductId).max(500).default([]),
  order: z
    .object({
      order_id: z.union([z.string(), z.number()]).transform(String),
      total: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      product_ids: z.array(ProductId).max(500).optional(),
      dtd_rid: z.string().max(100).nullable().optional(),
    })
    .optional(),
});
export type WebhookBody = z.infer<typeof WebhookBodySchema>;
