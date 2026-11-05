/**
 * Ana sayfa iskeleti (F0.5). Sunucuda üretilir (SSR). Gerçek içerik F2'de (2D vitrin, mağaza ve ürün sayfaları)
 * ve F4'te (3D şehir kabuğu) gelir.
 */
const DISTRICTS = [
  ['Merkez Meydan', 'Şehre giriş, tramvay durağı ve yönlendirme'],
  ['Enerji Çarşısı', 'Solar paneller, inverterler ve aküler'],
  ['Eğitim Sokağı', 'Deneme sınavları ve eğitim yayınları'],
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <p className="text-xs font-semibold tracking-wide text-accent uppercase">Yakında</p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Dijital Ticaret Dünyası</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Gerçek mağazaları gezilebilir bir 3D alışveriş şehrinde ve klasik 2D katalogda bir araya getiriyoruz.
        Satın alma, mağazanın kendi sitesinde güvenle tamamlanır.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-3">
        {DISTRICTS.map(([name, text]) => (
          <li key={name} className="rounded-lg border border-line bg-surface p-4">
            <h2 className="font-medium">{name}</h2>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
