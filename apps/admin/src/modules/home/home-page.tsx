import type { AdminMe } from '@dtd/contracts';
import { SystemStatus } from './system-status';

const SECTIONS = [
  ['#/sources', 'Kaynak siteler', 'Eşitleme durumu, token, elle eşitleme'],
  ['#/stores', 'Firmalar ve mağazalar', 'Ünvan, vergi no, mağaza adresi'],
  ['#/categories', 'Kategoriler', 'Platform ağacı ve kaynak kategori eşleme'],
  ['#/brands', 'Markalar', 'Marka listesi ve üretici adı eşleme'],
  ['#/rules', 'Görünürlük kuralları', 'Kurallar ve "neden görünmüyor?"'],
] as const;

const UPCOMING = [
  ['Yayın ve onay', 'F2 · değişiklik setleri, esnek dört göz'],
  ['Şehir editörü', 'F3 · bölge, yuva, portal'],
  ['3D varlıklar', 'F3 · kütüphane, lisans, LOD'],
] as const;

export function HomePage({ me }: { me: AdminMe }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Hoş geldiniz, {me.display_name}</h1>
      <p className="mt-1 text-sm text-muted">Roller: {me.roles.join(', ')}</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map(([href, title, hint]) => (
          <li key={href}>
            <a href={href} className="block h-full rounded-lg border border-line bg-surface p-4 hover:border-accent">
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-xs text-muted">{hint}</p>
            </a>
          </li>
        ))}
      </ul>
      <h2 className="mt-8 text-sm font-medium text-muted">Sıradaki fazlar</h2>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {UPCOMING.map(([title, phase]) => (
          <li key={title} className="rounded-lg border border-dashed border-line p-4">
            <p className="font-medium text-muted">{title}</p>
            <p className="mt-1 text-xs text-muted">{phase}</p>
          </li>
        ))}
      </ul>
      <SystemStatus canResolve={me.roles.includes('platform_admin')} />
    </>
  );
}
