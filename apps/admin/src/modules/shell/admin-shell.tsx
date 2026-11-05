import type { AdminMe } from '@dtd/contracts';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../shared/api';
import { useRoute } from '../../shared/data';
import { Button, cn } from '../../shared/ui';
import { BrandsPage } from '../catalog/brands-page';
import { CategoriesPage } from '../catalog/categories-page';
import { StoresPage } from '../commerce/stores-page';
import { HomePage } from '../home/home-page';
import { SourcesPage } from '../integration/sources-page';
import { RulesPage } from '../rules/rules-page';

const NAV = [
  ['/', 'Genel'],
  ['/sources', 'Kaynak siteler'],
  ['/stores', 'Firmalar ve mağazalar'],
  ['/categories', 'Kategoriler'],
  ['/brands', 'Markalar'],
  ['/rules', 'Kurallar'],
] as const;

/** Oturum açmış yöneticinin çerçevesi: üst menü + hash ile seçilen sayfa. */
export function AdminShell({ me, onLoggedOut }: { me: AdminMe; onLoggedOut: () => void }) {
  const route = useRoute();
  const [busy, setBusy] = useState(false);
  const canWrite = me.roles.includes('platform_admin');

  let page;
  switch (route) {
    case '/sources':
      page = <SourcesPage canWrite={canWrite} />;
      break;
    case '/stores':
      page = <StoresPage canWrite={canWrite} />;
      break;
    case '/categories':
      page = <CategoriesPage canWrite={canWrite} />;
      break;
    case '/brands':
      page = <BrandsPage canWrite={canWrite} />;
      break;
    case '/rules':
      page = <RulesPage canWrite={canWrite} />;
      break;
    default:
      page = <HomePage me={me} />;
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <p className="font-semibold">Dijital Ticaret Dünyası · Yönetim</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{me.display_name}</span>
            <Button
              variant="ghost"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await api('/admin/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
                onLoggedOut();
              }}
            >
              <LogOut className="size-4" aria-hidden />
              Çıkış
            </Button>
          </div>
        </div>
        <nav aria-label="Bölümler" className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1">
            {NAV.map(([href, label]) => {
              const active = route === href;
              return (
                <li key={href}>
                  <a
                    href={`#${href}`}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block border-b-2 px-3 py-2 text-sm whitespace-nowrap',
                      active ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
                    )}
                  >
                    {label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{page}</main>
    </div>
  );
}
