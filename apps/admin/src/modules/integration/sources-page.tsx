import { ChevronDown, ChevronRight, KeyRound, Pause, Play, RefreshCw } from 'lucide-react';
import { type FormEvent, Fragment, useState } from 'react';
import { api } from '../../shared/api';
import { fmtAgo, fmtDate, useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, Field, PageHeader, type Tone } from '../../shared/ui';

type Health = 'no_token' | 'paused' | 'failing' | 'stale' | 'ok';
interface RunStats {
  pages?: number;
  fetched?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  removed?: number;
  invalid?: number;
  drift_ids?: string[];
}
export interface Source {
  id: string;
  code: string;
  base_url: string;
  status: 'active' | 'paused';
  health: Health;
  has_token: boolean;
  watermark: string | null;
  last_full_sync_at: string | null;
  last_delta_sync_at: string | null;
  reconciled_in_window: boolean;
  consecutive_failures: number;
  circuit_open_until: string | null;
  last_error: string | null;
  catalog: { total: number; active: number; priced: number; unmapped_categories: number };
}
interface Run {
  id: string;
  kind: 'full' | 'delta';
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at: string | null;
  stats: RunStats;
  error: string | null;
}

const HEALTH: Record<Health, [string, Tone]> = {
  ok: ['Güncel', 'ok'],
  stale: ['Gecikmeli', 'warn'],
  failing: ['Hata', 'danger'],
  paused: ['Durduruldu', 'muted'],
  no_token: ['Token yok', 'warn'],
};

/** Kaynak siteler ve eşitleme izleme (F1.3). */
export function SourcesPage({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useResource<{ items: Source[]; delta_interval_minutes: number }>(
    '/admin/v1/integration/sources',
  );
  const [open, setOpen] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, message: string) {
    setNotice(null);
    if ((await action.run(fn)).ok) {
      setNotice(message);
      await reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Kaynak siteler"
        description={`Ürünler kaynak sitelerden ${data?.delta_interval_minutes ?? 5} dakikada bir değişenler, her gece 04:30'da tamamı olmak üzere eşitlenir. Fiyat ve stok kaynaktan gelir; platform hesaplamaz.`}
        actions={
          <Button variant="ghost" onClick={() => void reload()} busy={loading} aria-label="Yenile">
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        }
      />
      <div className="mt-4 space-y-2">
        {error && <Alert>{error}</Alert>}
        {action.error && <Alert>{action.error}</Alert>}
        {notice && !action.error && <Alert tone="ok">{notice}</Alert>}
      </div>
      {data && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="w-8 p-3" />
                <th className="p-3 font-medium">Site</th>
                <th className="p-3 font-medium">Durum</th>
                <th className="p-3 font-medium">Son değişiklik eşitlemesi</th>
                <th className="p-3 font-medium">Son tam eşitleme</th>
                <th className="p-3 text-right font-medium">Aktif / toplam ürün</th>
                <th className="p-3 text-right font-medium">Eşlenmemiş kategori</th>
                {canWrite && <th className="p-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((s) => {
                const [label, tone] = HEALTH[s.health];
                const expanded = open === s.code;
                return (
                  <Fragment key={s.code}>
                    <tr>
                      <td className="p-3">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${s.code} ayrıntıları`}
                          onClick={() => setOpen(expanded ? null : s.code)}
                          className="rounded p-1 text-muted hover:bg-surface-2"
                        >
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </td>
                      <td className="p-3">
                        <p className="font-medium">{s.code}</p>
                        <a href={s.base_url} target="_blank" rel="noreferrer" className="text-xs text-muted hover:underline">
                          {s.base_url.replace(/^https?:\/\//, '')}
                        </a>
                      </td>
                      <td className="p-3">
                        <Badge tone={tone}>{label}</Badge>
                        {s.consecutive_failures > 0 && (
                          <p className="mt-1 max-w-56 text-xs text-danger" title={s.last_error ?? ''}>
                            {s.consecutive_failures}× · {s.last_error}
                          </p>
                        )}
                      </td>
                      <td className="p-3" title={fmtDate(s.last_delta_sync_at)}>
                        {fmtAgo(s.last_delta_sync_at)}
                      </td>
                      <td className="p-3" title={fmtDate(s.last_full_sync_at)}>
                        {fmtAgo(s.last_full_sync_at)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {s.catalog.active} / {s.catalog.total}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {s.catalog.unmapped_categories > 0 ? (
                          <a href="#/categories" className="text-accent hover:underline">
                            {s.catalog.unmapped_categories}
                          </a>
                        ) : (
                          0
                        )}
                      </td>
                      {canWrite && (
                        <td className="p-3">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" className="h-8 px-2" onClick={() => setTokenFor(s.code)} title="Token gir">
                              <KeyRound className="size-4" aria-hidden />
                              <span className="sr-only">{s.code} token gir</span>
                            </Button>
                            <Button
                              variant="ghost"
                              className="h-8 px-2 whitespace-nowrap"
                              disabled={!s.has_token}
                              busy={action.busy}
                              onClick={() =>
                                void act(
                                  () => api(`/admin/v1/integration/sources/${s.code}/sync`, { method: 'POST', body: { kind: 'full' } }),
                                  `${s.code}: tam eşitleme sıraya alındı, bir dakika içinde başlar.`,
                                )
                              }
                            >
                              Tam eşitle
                            </Button>
                            <Button
                              variant="ghost"
                              className="h-8 px-2"
                              title={s.status === 'active' ? 'Durdur' : 'Devam ettir'}
                              onClick={() =>
                                void act(
                                  () =>
                                    api(`/admin/v1/integration/sources/${s.code}/status`, {
                                      method: 'PUT',
                                      body: { status: s.status === 'active' ? 'paused' : 'active' },
                                    }),
                                  s.status === 'active' ? `${s.code} durduruldu.` : `${s.code} yeniden eşitlenecek.`,
                                )
                              }
                            >
                              {s.status === 'active' ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                              <span className="sr-only">{s.status === 'active' ? 'Durdur' : 'Devam ettir'}</span>
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {tokenFor === s.code && (
                      <tr>
                        <td colSpan={canWrite ? 8 : 7} className="bg-surface-2 p-4">
                          <TokenForm
                            code={s.code}
                            onDone={async (msg) => {
                              setTokenFor(null);
                              setNotice(msg);
                              await reload();
                            }}
                            onCancel={() => setTokenFor(null)}
                          />
                        </td>
                      </tr>
                    )}
                    {expanded && (
                      <tr>
                        <td colSpan={canWrite ? 8 : 7} className="bg-surface-2 p-4">
                          <SourceDetail source={s} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TokenForm({ code, onDone, onCancel }: { code: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [token, setToken] = useState('');
  const action = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() => api(`/admin/v1/integration/sources/${code}/token`, { method: 'PUT', body: { token } }));
    if (r.ok) {
      setToken('');
      onDone(`${code}: token kaydedildi. Eşitleme bir dakika içinde başlar.`);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="max-w-xl space-y-3">
      <Field
        label={`${code} API token'ı`}
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        hint="Kaynak sitenin panelinde products.public_read kapsamıyla açın. Token şifreli saklanır ve bir daha gösterilmez."
        required
        minLength={20}
      />
      {action.error && <Alert>{action.error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" busy={action.busy}>
          Kaydet
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

const RUN_KIND = { full: 'Tam', delta: 'Değişiklik' } as const;
const RUN_STATUS: Record<Run['status'], [string, Tone]> = {
  succeeded: ['Başarılı', 'ok'],
  failed: ['Başarısız', 'danger'],
  running: ['Sürüyor', 'accent'],
};

function SourceDetail({ source }: { source: Source }) {
  const { data, error } = useResource<{ items: Run[] }>(`/admin/v1/integration/sources/${source.code}/runs?limit=15`);
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">Filigran (kaynak saati)</dt>
          <dd className="font-mono">{source.watermark ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Fiyatlı ürün</dt>
          <dd>{source.catalog.priced}</dd>
        </div>
        <div>
          <dt className="text-muted">Bu gece uzlaştırıldı</dt>
          <dd>{source.reconciled_in_window ? 'evet' : 'henüz değil'}</dd>
        </div>
      </dl>
      {error && <Alert>{error}</Alert>}
      {data && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 font-medium">Başlangıç</th>
              <th className="py-1 font-medium">Tür</th>
              <th className="py-1 font-medium">Sonuç</th>
              <th className="py-1 text-right font-medium">Çekilen</th>
              <th className="py-1 text-right font-medium">Yeni</th>
              <th className="py-1 text-right font-medium">Güncellenen</th>
              <th className="py-1 text-right font-medium">Değişmeyen</th>
              <th className="py-1 text-right font-medium">Kaynakta yok</th>
              <th className="py-1 text-right font-medium" title="Gece uzlaştırmasının bulduğu, değişiklik eşitlemesinin kaçırdığı fark">
                Sapma
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1">{fmtDate(r.started_at)}</td>
                <td className="py-1">{RUN_KIND[r.kind]}</td>
                <td className="py-1">
                  <Badge tone={RUN_STATUS[r.status][1]}>{RUN_STATUS[r.status][0]}</Badge>
                  {r.error && <span className="ml-2 text-danger">{r.error}</span>}
                </td>
                <td className="py-1 text-right tabular-nums">{r.stats.fetched ?? 0}</td>
                <td className="py-1 text-right tabular-nums">{r.stats.created ?? 0}</td>
                <td className="py-1 text-right tabular-nums">{r.stats.updated ?? 0}</td>
                <td className="py-1 text-right tabular-nums">{r.stats.unchanged ?? 0}</td>
                <td className="py-1 text-right tabular-nums">{r.stats.removed ?? 0}</td>
                <td className="py-1 text-right tabular-nums">{r.kind === 'full' ? (r.stats.drift_ids?.length ?? 0) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
