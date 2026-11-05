import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { Alert, Button } from '../../shared/ui';

interface ErrorItem {
  fingerprint: string;
  source: string;
  name: string;
  message: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  context: { method?: string; path?: string } | null;
}
interface Job {
  job: string;
  ok: boolean;
  finished_at: string;
  detail: Record<string, unknown> | null;
}
export interface OpsStatus {
  open_errors: number;
  dead_letters: number;
  errors: ErrorItem[];
  jobs: Job[];
}

const JOB_NAMES: Record<string, string> = {
  backup: 'Gece yedeği',
  restore_test: 'Geri yükleme provası',
};
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/** Sistem durumu (F0.7): açık hatalar, ölü mektuplar, yedek ve prova sonuçları. */
export function SystemStatus({ canResolve }: { canResolve: boolean }) {
  const [data, setData] = useState<OpsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api<OpsStatus>('/admin/v1/ops/status'));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Durum alınamadı.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(fp: string) {
    await api(`/admin/v1/ops/errors/${fp}/resolve`, { method: 'POST' }).catch(() => undefined);
    await load();
  }

  const backup = data?.jobs.find((j) => j.job === 'backup');
  return (
    <section className="mt-10" aria-labelledby="sys-title">
      <div className="flex items-center justify-between">
        <h2 id="sys-title" className="text-lg font-semibold">
          Sistem durumu
        </h2>
        <Button variant="ghost" onClick={() => void load()} busy={busy} aria-label="Yenile">
          <RefreshCw className="size-4" aria-hidden />
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat label="Açık hata" value={data.open_errors} bad={data.open_errors > 0} />
            <Stat
              label="Teslim edilemeyen olay"
              value={data.dead_letters}
              bad={data.dead_letters > 0}
            />
            <li className="rounded-lg border border-line bg-surface p-4">
              <p className="text-xs text-muted">Son yedek</p>
              <p className="mt-1 font-medium">
                {backup
                  ? `${fmt(backup.finished_at)} · ${backup.ok ? 'başarılı' : 'BAŞARISIZ'}`
                  : 'Henüz yok'}
              </p>
            </li>
          </ul>
          {data.jobs.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {data.jobs.map((j) => (
                <li key={j.job} className="flex items-center gap-2">
                  {j.ok ? (
                    <CheckCircle2 className="size-4 text-ok" aria-hidden />
                  ) : (
                    <AlertTriangle className="size-4 text-danger" aria-hidden />
                  )}
                  {JOB_NAMES[j.job] ?? j.job}: {fmt(j.finished_at)}
                </li>
              ))}
            </ul>
          )}
          {data.errors.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
              {data.errors.map((e) => (
                <li
                  key={e.fingerprint}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {e.name}: {e.message}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {e.source}
                      {e.context?.path
                        ? ` · ${e.context.method ?? ''} ${e.context.path}`
                        : ''} · {e.count} kez · son {fmt(e.last_seen_at)}
                    </p>
                  </div>
                  {canResolve && (
                    <Button
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => void resolve(e.fingerprint)}
                    >
                      Çözüldü
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${bad ? 'text-danger' : ''}`}>{value}</p>
    </li>
  );
}
