import Link from 'next/link';
import type { ProductCard as Card } from '../lib/api';
import { productPath } from '../lib/format';
import { responsiveImage } from '../lib/images';
import { PriceTag } from './price-tag';

/** Ürün kartı. Görsel kutusu sabit oranlı: görsel geç gelse de yerleşim kaymaz (K4, CLS). */
export function ProductCard({ product, priority = false, storeName }: { product: Card; priority?: boolean; storeName?: string }) {
  return (
    <li className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <Link href={productPath(product)} className="flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <div className="aspect-square w-full bg-white">
          {product.image ? (
            // Kaynak sitelerin görselleri: boyutlar bilinmediği için kutu sabit, görsel içine sığdırılır
            <img
              {...responsiveImage(product.image, 'card')}
              sizes="(min-width: 1280px) 25vw, (min-width: 640px) 33vw, 50vw"
              alt=""
              width={400}
              height={400}
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              decoding="async"
              className="h-full w-full object-contain p-2"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">Görsel yok</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <h3 className="line-clamp-2 text-sm font-medium group-hover:underline">{product.name}</h3>
          {storeName && <p className="text-xs text-muted">{storeName}</p>}
          <div className="mt-auto">
            <PriceTag price={product.price} compact />
            {!product.in_stock && <p className="mt-1 text-xs font-medium text-warn">Stokta yok</p>}
          </div>
        </div>
      </Link>
    </li>
  );
}
