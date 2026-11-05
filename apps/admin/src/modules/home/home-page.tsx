import type { AdminMe } from '@dtd/contracts';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../shared/api';
import { Button } from '../../shared/ui';

const UPCOMING = [
  ['Mağazalar ve firmalar', 'F1 · ticari yapı ve kaynak siteler'],
  ['Katalog ve eşitleme', 'F1 · 5 pilot sitenin ürün aynası'],
  ['Görünürlük kuralları', 'F2 · kanal bazlı kurallar ve açıklama'],
  ['Yayın ve onay', 'F2 · değişiklik setleri, esnek dört göz'],
  ['Şehir editörü', 'F3 · bölge, yuva, portal'],
  ['3D varlıklar', 'F3 · kütüphane, lisans, LOD'],
] as const;

export function HomePage({ me, onLoggedOut }: { me: AdminMe; onLoggedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
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
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Hoş geldiniz, {me.display_name}</h1>
        <p className="mt-1 text-sm text-muted">Roller: {me.roles.join(', ')}</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {UPCOMING.map(([title, phase]) => (
            <li key={title} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-xs text-muted">{phase}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
