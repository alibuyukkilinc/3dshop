import { useMemo, useState } from 'react';
import { fmtAgo, useResource } from '../../shared/data';
import { Alert, Badge, PageHeader, SelectField } from '../../shared/ui';

interface Summary {
  days: number;
  totals: { redirects: number; orders: number; matched: number };
  rows: { channel: string; store_id: string; redirects: number; orders: number; amount_minor: number }[];
  recent: {
    id: string;
    external_order_id: string;
    amount_minor: number | null;
    currency: string | null;
    received_at: string;
    matched: boolean;
    channel: string | null;
    store_id: string | null;
  }[];
}
interface Company {
  stores: { id: string; name: string }[];
}

const CHANNEL: Record<string, string> = { '3d': '3D şehir', '2d': '2D vitrin', search: 'Arama', ai: 'AI rehber' };
const money = (minor: number | null, currency: string | null) =>
  minor === null ? '—' : `${(minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${currency ?? 'TRY'}`;

/** Dönüşüm (F5, K53): "Sitede satın al" yönlendirmeleri ve kaynak siteden gelen siparişlerin eşleşmesi. */
export function ConversionsPage() {
  const [days, setDays] = useState('30');
  const data = useResource<Summary>(`/admin/v1/analytics/conversions?days=${days}`);
  const companies = useResource<{ items: Company[] }>('/admin/v1/commerce/companies');
  const storeName = useMemo(
    () => new Map((companies.data?.items ?? []).flatMap((c) => c.stores.map((s) => [s.id, s.name] as const))),
    [companies.data],
  );
  const t = data.data?.totals;

  return (
    <>
      <PageHeader
        title="Dönüşüm"
        description="Ziyaretçiyi kaynak siteye gönderen her tıklama bir yönlendirme kaydıdır. Kaynak site sipariş olayında dtd_rid'i geri gönderince sipariş yönlendirmeye eşlenir (son tıklama, 30 gün). Kişisel veri tutulmaz."
      />
      {data.error && <Alert>{data.error}</Alert>}
      <div className="mt-4 flex items-center gap-3">
        <SelectField
          label="Dönem"
          className="w-40"
          value={days}
          onChange={setDays}
          options={[
            { value: '7', label: 'Son 7 gün' },
            { value: '30', label: 'Son 30 gün' },
            { value: '90', label: 'Son 90 gün' },
          ]}
        />
      </div>
      {t && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ['Yönlendirme', t.redirects],
            ['Gelen sipariş', t.orders],
            ['Eşleşen sipariş', t.matched],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-surface p-4">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {t && t.orders === 0 && (
        <p className="mt-3 text-sm text-muted">
          Henüz sipariş olayı gelmedi. Kaynak sitede webhook (order.created) açılıp dtd_rid sipariş olayına eklenince dolar.
        </p>
      )}

      <section aria-labelledby="conv-rows" className="mt-8">
        <h2 id="conv-rows" className="font-semibold">
          Kanal ve mağaza
        </h2>
        <table className="mt-3 w-full rounded-lg border border-line bg-surface text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="p-2">Kanal</th>
              <th className="p-2">Mağaza</th>
              <th className="p-2 text-right">Yönlendirme</th>
              <th className="p-2 text-right">Sipariş</th>
              <th className="p-2 text-right">Oran</th>
              <th className="p-2 text-right">Ciro (TRY)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.data?.rows.map((r) => (
              <tr key={`${r.channel}:${r.store_id}`}>
                <td className="p-2">{CHANNEL[r.channel] ?? r.channel}</td>
                <td className="p-2">{storeName.get(r.store_id) ?? '…'}</td>
                <td className="p-2 text-right tabular-nums">{r.redirects}</td>
                <td className="p-2 text-right tabular-nums">{r.orders}</td>
                <td className="p-2 text-right tabular-nums">{r.redirects ? `%${((r.orders / r.redirects) * 100).toFixed(1)}` : '—'}</td>
                <td className="p-2 text-right tabular-nums">{money(r.amount_minor, 'TRY')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="conv-recent" className="mt-8">
        <h2 id="conv-recent" className="font-semibold">
          Son siparişler
        </h2>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {data.data?.recent.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 p-3">
              <Badge tone={c.matched ? 'ok' : 'muted'}>{c.matched ? 'eşleşti' : 'eşleşmedi'}</Badge>
              <code className="text-xs">{c.external_order_id}</code>
              <span className="tabular-nums">{money(c.amount_minor, c.currency)}</span>
              {c.channel && <span className="text-muted">{CHANNEL[c.channel] ?? c.channel}</span>}
              {c.store_id && <span className="text-muted">{storeName.get(c.store_id) ?? ''}</span>}
              <span className="ml-auto text-xs text-muted">{fmtAgo(c.received_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
