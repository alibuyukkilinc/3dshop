import { type FormEvent, useMemo, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { fmtAgo, useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, Field, PageHeader, SelectField } from '../../shared/ui';
import { openChangeset } from '../publishing/changesets-page';

interface Slot {
  id: string;
  scene_id: string;
  region_id: string;
  slot_key: string;
  kind: string;
  store_id: string | null;
  capacity: number;
  status: 'active' | 'orphaned';
  live: { position: number; product_id: string; name: string | null; source: 'pin' | 'rule' | 'default'; rule_id: string | null }[];
  pins: { id: string; position: number; product_id: string; name: string | null; locked: boolean; reason: string | null }[];
}
interface Rule {
  id: string;
  name: string;
  store_id: string | null;
  category_id: string | null;
  brand_id: string | null;
  in_stock: boolean;
  sort_by: string;
  limit_per_slot: number;
  priority: number;
  status: 'active' | 'archived';
}
interface Run {
  id: string;
  trigger: string;
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  stats: { placed?: number; slots?: number; changed?: boolean; by_source?: Record<string, number> };
  error: string | null;
}
interface Company {
  stores: { id: string; name: string }[];
}
interface Named {
  id: string;
  name: string;
}
interface ProductHit {
  id: string;
  name: string;
  store_id: string;
  status: string;
}

const SORT: Record<string, string> = {
  relevance: 'Alaka (öne çıkarma dahil)',
  newest: 'En yeni',
  price_asc: 'Fiyat: artan',
  price_desc: 'Fiyat: azalan',
  name: 'Ada göre',
};
const SOURCE = { pin: ['Pin', 'accent'], rule: ['Kural', 'ok'], default: ['Varsayılan', 'muted'] } as const;

/** Yerleşim (F5.1, K23): vitrin yuvaları, elle pin ve kurallar. Pin ve kural changeset ile yayınlanır (K44). */
export function PlacementPage({ canPrepare, canRun }: { canPrepare: boolean; canRun: boolean }) {
  const slots = useResource<{ items: Slot[] }>('/admin/v1/placement/slots');
  const rules = useResource<{ items: Rule[] }>('/admin/v1/placement/rules');
  const runs = useResource<{ items: Run[] }>('/admin/v1/placement/runs');
  const companies = useResource<{ items: Company[] }>('/admin/v1/commerce/companies');
  const categories = useResource<{ items: Named[] }>('/admin/v1/catalog/categories');
  const brands = useResource<{ items: Named[] }>('/admin/v1/commerce/brands');
  const action = useAction();
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [newRule, setNewRule] = useState(false);

  const storeName = useMemo(
    () => new Map((companies.data?.items ?? []).flatMap((c) => c.stores.map((s) => [s.id, s.name] as const))),
    [companies.data],
  );
  const byStore = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots.data?.items ?? []) m.set(s.store_id ?? '', [...(m.get(s.store_id ?? '') ?? []), s]);
    return [...m.entries()];
  }, [slots.data]);
  const nameOf = (list: Named[] | undefined, id: string | null) => (id ? (list?.find((x) => x.id === id)?.name ?? '…') : null);

  async function runNow() {
    const r = await action.run(() => api('/admin/v1/placement/run', { method: 'POST' }));
    if (r.ok) await Promise.all([slots.reload(), runs.reload()]);
  }

  return (
    <>
      <PageHeader
        title="Yerleşim"
        description="Vitrin yuvalarına hangi ürünün konacağı. Elle pin her zaman kuraldan önce gelir; kalan yuvaları kurallar, sonra mağazanın en alakalı ürünleri doldurur. Yalnız 3D kanalında görünen ürünler yerleşir."
      />
      {(slots.error || rules.error || runs.error) && <Alert>{slots.error ?? rules.error ?? runs.error}</Alert>}
      {action.error && <Alert>{action.error}</Alert>}

      <section aria-labelledby="slots-title" className="mt-6">
        <div className="flex items-center gap-3">
          <h2 id="slots-title" className="font-semibold">
            Yuvalar
          </h2>
          {canRun && (
            <Button variant="ghost" busy={action.busy} onClick={() => void runNow()}>
              Şimdi çalıştır
            </Button>
          )}
        </div>
        {slots.data?.items.length === 0 && (
          <p className="mt-2 text-sm text-muted">Henüz yuva yok. Yuvalar yayındaki bölge sahnelerindeki “slot” düğümlerinden gelir.</p>
        )}
        <div className="mt-3 space-y-4">
          {byStore.map(([storeId, list]) => (
            <div key={storeId || 'none'} className="rounded-lg border border-line bg-surface">
              <p className="border-b border-line px-3 py-2 text-sm font-medium">
                {storeId ? (storeName.get(storeId) ?? 'Mağaza') : 'Mağazası olmayan yuvalar (yakında giriş yok)'}
              </p>
              <ul className="divide-y divide-line text-sm">
                {list.map((s) => (
                  <li key={s.id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-xs">{s.slot_key}</code>
                      {s.status === 'orphaned' && <Badge tone="warn">sahneden kalktı</Badge>}
                      {s.live.length === 0 && s.status === 'active' && <span className="text-muted">boş</span>}
                      {s.live.map((l) => (
                        <span key={l.position} className="flex items-center gap-1">
                          <Badge tone={SOURCE[l.source][1]}>{SOURCE[l.source][0]}</Badge>
                          {l.name ?? l.product_id}
                        </span>
                      ))}
                      {canPrepare && s.store_id && s.status === 'active' && pinFor !== s.id && (
                        <button type="button" className="ml-auto text-xs text-accent hover:underline" onClick={() => setPinFor(s.id)}>
                          Sabitle…
                        </button>
                      )}
                    </div>
                    {s.pins.map((p) => (
                      <p key={p.id} className="mt-1 flex items-center gap-2 text-xs text-muted">
                        Pin: {p.name ?? p.product_id} {p.reason && `— ${p.reason}`}
                        {canPrepare && (
                          <button
                            type="button"
                            className="text-accent hover:underline"
                            onClick={() =>
                              void action.run(() =>
                                openChangeset(`Pin kaldır: ${p.name ?? p.product_id}`, [{ entity_type: 'placement_pin', entity_id: p.id, op: 'remove' }]),
                              )
                            }
                          >
                            kaldır…
                          </button>
                        )}
                      </p>
                    ))}
                    {pinFor === s.id && <PinForm slot={s} onCancel={() => setPinFor(null)} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="prules-title" className="mt-8">
        <div className="flex items-center gap-3">
          <h2 id="prules-title" className="font-semibold">
            Kurallar
          </h2>
          {canPrepare && !newRule && (
            <Button variant="ghost" onClick={() => setNewRule(true)}>
              Yeni kural…
            </Button>
          )}
        </div>
        {newRule && (
          <RuleForm
            stores={[...storeName.entries()].map(([value, label]) => ({ value, label }))}
            categories={categories.data?.items ?? []}
            brands={brands.data?.items ?? []}
            onCancel={() => setNewRule(false)}
          />
        )}
        {rules.data?.items.length === 0 && <p className="mt-2 text-sm text-muted">Kural yok: yuvalar mağazanın en alakalı ürünleriyle dolar.</p>}
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {rules.data?.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="font-medium">{r.name}</span>
              <Badge tone={r.status === 'active' ? 'ok' : 'muted'}>{r.status === 'active' ? 'etkin' : 'arşiv'}</Badge>
              <span className="text-muted">
                {r.store_id ? (storeName.get(r.store_id) ?? 'mağaza') : 'tüm mağazalar'}
                {r.category_id && ` · ${nameOf(categories.data?.items, r.category_id)}`}
                {r.brand_id && ` · ${nameOf(brands.data?.items, r.brand_id)}`}
                {r.in_stock && ' · stokta'} · {SORT[r.sort_by] ?? r.sort_by} · öncelik {r.priority} · yuva başına {r.limit_per_slot}
              </span>
              {canPrepare && (
                <button
                  type="button"
                  className="ml-auto text-xs text-accent hover:underline"
                  onClick={() =>
                    void action.run(() =>
                      openChangeset(`Yerleşim kuralı ${r.status === 'active' ? 'arşivle' : 'etkinleştir'}: ${r.name}`, [
                        { entity_type: 'placement_rule', entity_id: r.id, op: r.status === 'active' ? 'archive' : 'activate' },
                      ]),
                    )
                  }
                >
                  {r.status === 'active' ? 'Arşivle…' : 'Etkinleştir…'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pruns-title" className="mt-8">
        <h2 id="pruns-title" className="font-semibold">
          Son çalıştırmalar
        </h2>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {runs.data?.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
              <Badge tone={r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'danger' : 'muted'}>{r.status}</Badge>
              <span>{fmtAgo(r.started_at)}</span>
              <span className="text-muted">
                {r.trigger} · {r.stats.placed ?? 0}/{r.stats.slots ?? 0} yuva dolu
                {r.stats.by_source && ` (pin ${r.stats.by_source.pin ?? 0}, kural ${r.stats.by_source.rule ?? 0}, varsayılan ${r.stats.by_source.default ?? 0})`}
                {r.stats.changed ? ' · yayına geçti' : ' · değişiklik yok'}
              </span>
              {r.error && <span className="text-danger">{r.error}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function PinForm({ slot, onCancel }: { slot: Slot; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [pick, setPick] = useState<ProductHit | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ items: ProductHit[] }>(`/admin/v1/catalog/products?q=${encodeURIComponent(q)}&limit=20`);
      setHits(r.items.filter((p) => p.store_id === slot.store_id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Arama başarısız.');
    }
  }
  async function submit() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await openChangeset(`Pin: ${slot.slot_key} → ${pick.name}`, [
        { entity_type: 'placement_pin', op: 'create', payload: { slot_id: slot.id, product_id: pick.id, reason } },
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Değişiklik seti açılamadı.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <form onSubmit={(e) => void search(e)} className="flex gap-2">
        <Field label="Ürün ara (ad, SKU, kaynak no)" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="ghost">
          Ara
        </Button>
      </form>
      {hits.length > 0 && (
        <ul className="max-h-48 overflow-auto rounded-md border border-line">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => setPick(h)}
                className={`w-full px-2 py-1 text-left text-sm hover:bg-bg ${pick?.id === h.id ? 'bg-bg font-medium' : ''}`}
              >
                {h.name} {h.status !== 'active' && <span className="text-xs text-muted">({h.status})</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Field label="Gerekçe" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kampanya ürünü, yeni gelen…" />
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button onClick={() => void submit()} busy={busy} disabled={!pick || reason.trim().length < 3}>
          Değişiklik seti aç
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

function RuleForm({
  stores,
  categories,
  brands,
  onCancel,
}: {
  stores: { value: string; label: string }[];
  categories: Named[];
  brands: Named[];
  onCancel: () => void;
}) {
  const [f, setF] = useState({ name: '', store_id: '', category_id: '', brand_id: '', sort_by: 'relevance', priority: '0', limit: '1', in_stock: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await openChangeset(`Yerleşim kuralı: ${f.name}`, [
        {
          entity_type: 'placement_rule',
          op: 'create',
          payload: {
            name: f.name,
            store_id: f.store_id || null,
            category_id: f.category_id || null,
            brand_id: f.brand_id || null,
            in_stock: f.in_stock,
            sort_by: f.sort_by,
            priority: Number(f.priority),
            limit_per_slot: Number(f.limit),
          },
        },
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Değişiklik seti açılamadı.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-2 rounded-lg border border-line bg-surface p-3">
      <Field label="Ad" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} />
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField label="Mağaza" value={f.store_id} onChange={(v) => setF({ ...f, store_id: v })} options={stores} placeholder="Tüm mağazalar" />
        <SelectField label="Sıralama" value={f.sort_by} onChange={(v) => setF({ ...f, sort_by: v })} options={Object.entries(SORT).map(([value, label]) => ({ value, label }))} />
        <SelectField
          label="Kategori"
          value={f.category_id}
          onChange={(v) => setF({ ...f, category_id: v })}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Tüm kategoriler"
        />
        <SelectField
          label="Marka"
          value={f.brand_id}
          onChange={(v) => setF({ ...f, brand_id: v })}
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
          placeholder="Tüm markalar"
        />
        <Field label="Öncelik (büyük önce)" inputMode="numeric" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} />
        <Field label="Yuva başına en çok" inputMode="numeric" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.in_stock} onChange={(e) => setF({ ...f, in_stock: e.target.checked })} /> Yalnız stoktakiler
      </label>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" busy={busy}>
          Değişiklik seti aç
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}
