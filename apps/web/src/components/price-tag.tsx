import type { Price } from '../lib/api';
import { formatMinor } from '../lib/format';

/** Fiyat kaynağın son fiyatıdır (K41); indirimliyse liste fiyatı üstü çizili. Fiyatsız ürün sitede sorulur. */
export function PriceTag({ price, compact = false }: { price: Price | null; compact?: boolean }) {
  if (!price) return <p className="text-sm text-muted">Fiyat için mağaza sitesine bakın</p>;
  const discounted = price.list_minor > price.final_minor;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className={compact ? 'text-base font-semibold' : 'text-3xl font-semibold'}>{formatMinor(price.final_minor, price.currency)}</span>
      {discounted && (
        <span className="text-sm text-muted line-through">
          <span className="sr-only">İndirimsiz fiyat: </span>
          {formatMinor(price.list_minor, price.currency)}
        </span>
      )}
    </p>
  );
}
