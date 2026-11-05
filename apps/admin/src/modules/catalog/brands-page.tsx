import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../shared/api';
import { useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, Field, PageHeader, SelectField } from '../../shared/ui';

interface Brand {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'archived';
  version: number;
}
interface SourceBrand {
  source_site_id: string;
  source_name: string;
  source_key: string;
  products: number;
  active_products: number;
  mapping: { brand_id: string | null; ignored: boolean; method: string } | null;
  suggestion: string | null;
}
interface Source {
  id: string;
  code: string;
}

const IGNORE = '__ignore__';

/** Marka listesi ve kaynak üretici adı eşleme (F1.3). "Genel", "id0" gibi değerler "marka değil" işaretlenir. */
export function BrandsPage({ canWrite }: { canWrite: boolean }) {
  const brands = useResource<{ items: Brand[] }>('/admin/v1/commerce/brands');
  const sources = useResource<{ items: Source[] }>('/admin/v1/integration/sources');
  const [onlyUnmapped, setOnlyUnmapped] = useState(true);
  const sourceBrands = useResource<{ items: SourceBrand[] }>(
    `/admin/v1/catalog/source-brands${onlyUnmapped ? '?unmapped=1' : ''}`,
  );
  const siteCode = (id: string) => sources.data?.items.find((s) => s.id === id)?.code ?? '';
  const active = (brands.data?.items ?? []).filter((b) => b.status === 'active');
  const action = useAction();

  async function map(sb: SourceBrand, brandId: string | null) {
    const r = await action.run(() =>
      api('/admin/v1/catalog/brand-mappings', {
        method: 'PUT',
        body: { source_site_id: sb.source_site_id, source_name: sb.source_name, brand_id: brandId },
      }),
    );
    if (r.ok) await sourceBrands.reload();
  }

  /** Kaynak adından marka açıp aynı anda eşler (en sık iş). */
  async function createAndMap(sb: SourceBrand) {
    const r = await action.run(async () => {
      const brand = await api<Brand>('/admin/v1/commerce/brands', {
        method: 'POST',
        body: { name: sb.source_name },
      });
      await api('/admin/v1/catalog/brand-mappings', {
        method: 'PUT',
        body: {
          source_site_id: sb.source_site_id,
          source_name: sb.source_name,
          brand_id: brand.id,
        },
      });
    });
    if (r.ok) await Promise.all([brands.reload(), sourceBrands.reload()]);
  }

  return (
    <>
      <PageHeader
        title="Markalar"
        description="Kaynak sitelerdeki üretici adları platform markalarına eşlenir. Aynı marka farklı sitelerde farklı yazılmış olabilir (DEYE, Deye); hepsi tek markaya bağlanır."
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section
          aria-labelledby="brands-title"
          className="rounded-lg border border-line bg-surface p-4"
        >
          <h2 id="brands-title" className="font-semibold">
            Platform markaları
          </h2>
          {brands.error && <Alert>{brands.error}</Alert>}
          <ul className="mt-3 flex flex-wrap gap-2">
            {brands.data?.items.map((b) => (
              <li key={b.id}>
                <Badge tone={b.status === 'active' ? 'accent' : 'muted'}>{b.name}</Badge>
              </li>
            ))}
          </ul>
          {brands.data?.items.length === 0 && (
            <p className="mt-2 text-sm text-muted">Henüz marka yok.</p>
          )}
          {canWrite && <NewBrand onCreated={brands.reload} />}
        </section>

        <section
          aria-labelledby="sb-title"
          className="rounded-lg border border-line bg-surface p-4"
        >
          <h2 id="sb-title" className="font-semibold">
            Kaynaktaki üretici adları
          </h2>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyUnmapped}
              onChange={(e) => setOnlyUnmapped(e.target.checked)}
            />
            Yalnız eşlenmemişler
          </label>
          {(sourceBrands.error || action.error) && (
            <div className="mt-3">
              <Alert>{sourceBrands.error ?? action.error}</Alert>
            </div>
          )}
          {sourceBrands.data?.items.length === 0 && (
            <p className="mt-4 text-sm text-muted">
              {onlyUnmapped ? 'Eşlenmemiş üretici adı kalmadı.' : 'Üretici adı yok.'}
            </p>
          )}
          <ul className="mt-3 divide-y divide-line text-sm">
            {sourceBrands.data?.items.map((sb) => {
              const current = sb.mapping
                ? sb.mapping.ignored
                  ? IGNORE
                  : (sb.mapping.brand_id ?? '')
                : '';
              const suggested = sb.suggestion
                ? active.find((b) => b.id === sb.suggestion)
                : undefined;
              return (
                <li
                  key={`${sb.source_site_id}|${sb.source_key}`}
                  className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{sb.source_name}</p>
                    <p className="text-xs text-muted">
                      {siteCode(sb.source_site_id)} · {sb.active_products} aktif / {sb.products}{' '}
                      ürün
                    </p>
                  </div>
                  {canWrite && !sb.mapping && (
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      busy={action.busy}
                      onClick={() => void (suggested ? map(sb, suggested.id) : createAndMap(sb))}
                    >
                      {suggested ? `Öneri: ${suggested.name}` : 'Marka olarak ekle'}
                    </Button>
                  )}
                  <SelectField
                    label={`${sb.source_name} için marka`}
                    className="shrink-0 sm:w-56"
                    value={current}
                    disabled={!canWrite || action.busy}
                    onChange={(v) => v && void map(sb, v === IGNORE ? null : v)}
                    placeholder="— eşlenmedi —"
                    options={[
                      ...active.map((b) => ({ value: b.id, label: b.name })),
                      { value: IGNORE, label: 'Marka değil (yok say)' },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

function NewBrand({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const action = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() =>
      api('/admin/v1/commerce/brands', { method: 'POST', body: { name } }),
    );
    if (r.ok) {
      setName('');
      await onCreated();
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-2 border-t border-line pt-4">
      <Field
        label="Yeni marka"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
      />
      {action.error && <Alert>{action.error}</Alert>}
      <Button type="submit" busy={action.busy}>
        <Plus className="size-4" aria-hidden />
        Ekle
      </Button>
    </form>
  );
}
