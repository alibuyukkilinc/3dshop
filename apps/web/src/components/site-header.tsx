import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold">
          Dijital Ticaret Dünyası
        </Link>
        <form action="/ara" role="search" className="order-last w-full sm:order-none sm:w-auto sm:flex-1 sm:max-w-md">
          <label htmlFor="site-ara" className="sr-only">
            Ürün ara
          </label>
          <input
            id="site-ara"
            name="q"
            type="search"
            placeholder="Ürün ara: inverter, akü, deneme…"
            maxLength={100}
            className="h-10 w-full rounded-md border border-line bg-bg px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </form>
        <nav aria-label="Ana menü">
          <ul className="flex gap-4 text-sm">
            <li>
              <Link href="/" className="hover:underline">
                Mağazalar
              </Link>
            </li>
            <li>
              <Link href="/sehir" className="hover:underline">
                3D şehir
              </Link>
            </li>
            <li>
              <Link href="/harita" className="hover:underline">
                Harita
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted">
        Ürün, fiyat ve stok bilgileri mağazaların kendi sitelerinden alınır. Satın alma mağazanın sitesinde tamamlanır.
      </p>
    </footer>
  );
}
