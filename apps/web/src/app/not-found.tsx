import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı</h1>
      <p className="mt-2 text-muted">Aradığınız mağaza ya da ürün artık yayında olmayabilir.</p>
      <Link href="/" className="mt-6 inline-block text-accent underline">
        Mağazalara dön
      </Link>
    </main>
  );
}
