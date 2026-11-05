import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-semibold">
          Dijital Ticaret Dünyası
        </Link>
        <nav aria-label="Ana menü">
          <ul className="flex gap-4 text-sm">
            <li>
              <Link href="/" className="hover:underline">
                Mağazalar
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
