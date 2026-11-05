import { z } from 'zod';

/**
 * Kural koşul DSL'i (K43): yalnız JSON, kod çalıştırılmaz. Olgular düz bir sözlükten okunur
 * (product.stock, store.status, now …). Bilinmeyen olgu "yok" sayılır; karşılaştırma false döner.
 */
export const OPS = ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
export type Scalar = string | number | boolean | null;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; op: (typeof OPS)[number]; value?: Scalar | Scalar[] };

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1).max(20) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z
      .object({
        fact: z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/),
        op: z.enum(OPS),
        value: z.union([ScalarSchema, z.array(ScalarSchema).max(200)]).optional(),
      })
      .strict(),
  ]),
);

export type Facts = Record<string, Scalar | Scalar[] | undefined>;

const MAX_DEPTH = 8;

export function evaluateCondition(cond: Condition | null | undefined, facts: Facts, depth = 0): boolean {
  if (!cond) return true;
  if (depth > MAX_DEPTH) return false;
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, facts, depth + 1));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, facts, depth + 1));
  if ('not' in cond) return !evaluateCondition(cond.not, facts, depth + 1);

  const actual = facts[cond.fact];
  const v = cond.value;
  switch (cond.op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return Array.isArray(actual) ? actual.includes(v as Scalar) : actual === v;
    case 'ne':
      return Array.isArray(actual) ? !actual.includes(v as Scalar) : actual !== v;
    case 'in':
      return Array.isArray(v) && (Array.isArray(actual) ? actual.some((a) => v.includes(a)) : v.includes(actual as Scalar));
    case 'nin':
      return Array.isArray(v) && (Array.isArray(actual) ? !actual.some((a) => v.includes(a)) : !v.includes(actual as Scalar));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (actual === undefined || actual === null || Array.isArray(actual) || v === null || v === undefined || Array.isArray(v)) return false;
      const [a, b] = [actual, v];
      if (typeof a !== typeof b) return false;
      if (cond.op === 'gt') return a > b;
      if (cond.op === 'gte') return a >= b;
      if (cond.op === 'lt') return a < b;
      return a <= b;
    }
  }
}
