import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, Field, PageHeader, SelectField } from '../../shared/ui';

interface Summary {
  days: number;
  from: string;
  totals: { name: string; events: number; sessions: number }[];
  daily: { day: string; counts: Record<string, number> }[];
  top: Record<'products' | 'stores' | 'searches' | 'regions' | 'outbound', { subject: string; events: number }[]>;
}
interface Company {
  stores: { id: string; name: string }[];
}

/** Olay sözlüğü (@dtd/contracts ANALYTICS_EVENTS) Türkçe adları */
const EVENT_LABEL: Record<string, string> = {
  page_view: 'Sayfa görüntüleme',
  world_enter: '3D şehre giriş',
  region_enter: 'Bölgeye giriş',
  store_enter: 'Mağaza açma',
  product_view: 'Ürün görüntüleme',
  search: 'Arama',
  ai_question: 'AI rehber sorusu',
  outbound_click: 'Sitede satın al tıklaması',
};

/** Platform olayları (F5.4, K15, K37) ve GA4 ayarı. Yalnız rıza veren ziyaretçiler sayılır. */
export function EventsPage({ canWrite }: { canWrite: boolean }) {
  const [days, setDays] = useState('7');
  const data = useResource<Summary>(`/admin/v1/analytics/events?days=${days}`);
  const companies = useResource<{ items: Company[] }>('/admin/v1/commerce/companies');
  const storeName = useMemo(
    () => new Map((companies.data?.items ?? []).flatMap((c) => c.stores.map((s) => [s.id, s.name] as const))),
    [companies.data],
  );
  const s = data.data;
  const hasData = (s?.totals.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Olaylar"
        description="Ziyaretçilerin yalnız izin verenleri sayılır (KVKK, varsayılan red). Kişisel veri tutulmaz; ham olaylar 13 ay saklanır, günlük özet kalır. Özet saatte bir yenilenir."
      />
      {data.error && <Alert>{data.error}</Alert>}
      <div className="mt-4">
        <SelectField
          label="Dönem"
          className="w-40"
          value={days}
          onChange={setDays}
          options={[
            { value: '1', label: 'Bugün' },
            { value: '7', label: 'Son 7 gün' },
            { value: '30', label: 'Son 30 gün' },
            { value: '90', label: 'Son 90 gün' },
          ]}
        />
      </div>

      {s && !hasData && <p className="mt-4 text-sm text-muted">Bu dönemde olay yok. İzin veren ziyaretçi geldikçe ve saatlik özet çalıştıkça dolar.</p>}

      {hasData && (
        <table className="mt-4 w-full rounded-lg border border-line bg-surface text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="p-2">Olay</th>
              <th className="p-2 text-right">Sayı</th>
              <th className="p-2 text-right" title="Günlük tekil oturumların toplamı">
                Oturum (gün toplamı)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {s!.totals.map((t) => (
              <tr key={t.name}>
                <td className="p-2">
                  {EVENT_LABEL[t.name] ?? t.name} <code className="text-xs text-muted">{t.name}</code>
                </td>
                <td className="p-2 text-right tabular-nums">{t.events.toLocaleString('tr-TR')}</td>
                <td className="p-2 text-right tabular-nums">{t.sessions.toLocaleString('tr-TR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasData && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <TopList title="En çok bakılan ürünler" rows={s!.top.products} render={(id) => <code className="text-xs">{id}</code>} />
          <TopList title="En çok açılan mağazalar" rows={s!.top.stores} render={(id) => storeName.get(id) ?? <code className="text-xs">{id}</code>} />
          <TopList title="Arama terimleri" rows={s!.top.searches} render={(q) => q} />
          <TopList title="Bölgeler (3D)" rows={s!.top.regions} render={(r) => r} />
        </div>
      )}

      <Ga4Settings canWrite={canWrite} />
    </>
  );
}

function TopList({
  title,
  rows,
  render,
}: {
  title: string;
  rows: { subject: string; events: number }[];
  render: (subject: string) => ReactNode;
}) {
  return (
    <section>
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Yok.</p>
      ) : (
        <ol className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {rows.map((r) => (
            <li key={r.subject} className="flex items-center gap-2 p-2">
              <span className="min-w-0 flex-1 truncate">{render(r.subject)}</span>
              <span className="tabular-nums text-muted">{r.events}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Ga4Settings({ canWrite }: { canWrite: boolean }) {
  const ga4 = useResource<{ measurement_id: string | null }>('/admin/v1/analytics/ga4');
  const action = useAction();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(ga4.data?.measurement_id ?? ''), [ga4.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const r = await action.run(() =>
      api('/admin/v1/analytics/ga4', { method: 'PUT', body: { measurement_id: value.trim() || null } }),
    );
    if (r.ok) {
      setSaved(true);
      void ga4.reload();
    }
  };

  return (
    <section aria-labelledby="ga4-title" className="mt-10 max-w-xl rounded-lg border border-line bg-surface p-4">
      <h2 id="ga4-title" className="flex items-center gap-2 font-semibold">
        Google Analytics 4 {ga4.data && <Badge tone={ga4.data.measurement_id ? 'ok' : 'muted'}>{ga4.data.measurement_id ? 'açık' : 'kapalı'}</Badge>}
      </h2>
      <p className="mt-1 text-sm text-muted">
        Platformun kendi GA4 mülkünün ölçüm kimliği. Girilince çerez bandında ayrı bir “Google Analytics” seçeneği çıkar
        (yurt dışına aktarım, ayrı açık rıza); önceden karar vermiş ziyaretçilere bir kez yeniden sorulur. Boş bırakılırsa
        Google'a hiçbir şey gönderilmez. Değişiklik web'e en geç 5 dakikada yansır.
      </p>
      {ga4.error && <Alert>{ga4.error}</Alert>}
      <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-3">
        <Field
          label="Ölçüm kimliği"
          placeholder="G-XXXXXXXXXX"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!canWrite}
          hint={canWrite ? undefined : 'Yalnız platform yöneticisi değiştirebilir.'}
        />
        {action.error && <Alert>{action.error}</Alert>}
        {saved && <Alert tone="ok">Kaydedildi.</Alert>}
        {canWrite && (
          <Button type="submit" busy={action.busy}>
            Kaydet
          </Button>
        )}
      </form>
    </section>
  );
}
