import { Plus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, Field, PageHeader, SelectField } from '../../shared/ui';

export interface Category {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  sort: number;
  status: 'active' | 'archived';
  version: number;
  product_count: number;
}
interface SourceCategory {
  id: string;
  source_site_id: string;
  name: string;
  products: number;
  active_products: number;
  mapping: { catalog_category_id: string | null; ignored: boolean; method: string } | null;
  suggestion: string | null;
}
interface Source {
  id: string;
  code: string;
}

const IGNORE = '__ignore__';

/** Ağacı "Üst › Alt" yollarıyla düzleştirir (seçim listesi ve girinti için). */
export function flattenTree(items: Category[]): (Category & { path: string; depth: number })[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of items) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
  const out: (Category & { path: string; depth: number })[] = [];
  const walk = (parent: string | null, prefix: string, depth: number) => {
    for (const c of (byParent.get(parent) ?? []).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'tr'))) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ ...c, path, depth });
      walk(c.id, path, depth + 1);
    }
  };
  walk(null, '', 0);
  return out;
}

/** Platform kategori ağacı ve kaynak kategori eşleme (F1.3). */
export function CategoriesPage({ canWrite }: { canWrite: boolean }) {
  const tree = useResource<{ items: Category[] }>('/admin/v1/catalog/categories');
  const sources = useResource<{ items: Source[] }>('/admin/v1/integration/sources');
  const [site, setSite] = useState('');
  const [onlyUnmapped, setOnlyUnmapped] = useState(true);
  const query = new URLSearchParams({ ...(site && { source_site_id: site }), ...(onlyUnmapped && { unmapped: '1' }) });
  const sourceCats = useResource<{ items: SourceCategory[] }>(`/admin/v1/catalog/source-categories?${query}`);
  const flat = useMemo(() => flattenTree(tree.data?.items ?? []), [tree.data]);
  const active = flat.filter((c) => c.status === 'active');
  const siteCode = (id: string) => sources.data?.items.find((s) => s.id === id)?.code ?? '';
  const action = useAction();
  // Ağaç değişince öneriler (ad eşleşmesi) de değişir: iki liste birlikte yenilenir
  const reloadAll = async () => {
    await Promise.all([tree.reload(), sourceCats.reload()]);
  };

  async function map(sc: SourceCategory, value: string) {
    const r = await action.run(() =>
      api(`/admin/v1/catalog/source-categories/${sc.id}/mapping`, {
        method: 'PUT',
        body: { catalog_category_id: value === IGNORE ? null : value },
      }),
    );
    if (r.ok) await reloadAll();
  }

  return (
    <>
      <PageHeader
        title="Kategoriler"
        description="Kaynak sitelerin kategorileri platformun tek ağacına eşlenir. Eşleme değişince ürünler hemen yeni kategoriye geçer; eşitleme eşlemeyi bozmaz."
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="tree-title" className="rounded-lg border border-line bg-surface p-4">
          <h2 id="tree-title" className="font-semibold">
            Platform ağacı
          </h2>
          {tree.error && <Alert>{tree.error}</Alert>}
          {flat.length === 0 && tree.data && <p className="mt-2 text-sm text-muted">Henüz kategori yok. İlk ana kategoriyi ekleyin.</p>}
          <ul className="mt-3 space-y-1 text-sm">
            {flat.map((c) => (
              <CategoryRow key={c.id} category={c} canWrite={canWrite} onChanged={reloadAll} />
            ))}
          </ul>
          {canWrite && <NewCategory parents={active} onCreated={reloadAll} />}
        </section>

        <section aria-labelledby="map-title" className="rounded-lg border border-line bg-surface p-4">
          <h2 id="map-title" className="font-semibold">
            Kaynak kategoriler
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SelectField
              label="Site"
              className="w-48"
              value={site}
              onChange={setSite}
              placeholder="Tüm siteler"
              options={(sources.data?.items ?? []).map((s) => ({ value: s.id, label: s.code }))}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />
              Yalnız eşlenmemişler
            </label>
          </div>
          {(sourceCats.error || action.error) && (
            <div className="mt-3">
              <Alert>{sourceCats.error ?? action.error}</Alert>
            </div>
          )}
          {sourceCats.data?.items.length === 0 && (
            <p className="mt-4 text-sm text-muted">{onlyUnmapped ? 'Eşlenmemiş kaynak kategori kalmadı.' : 'Kaynak kategori yok.'}</p>
          )}
          <ul className="mt-3 divide-y divide-line text-sm">
            {sourceCats.data?.items.map((sc) => {
              const current = sc.mapping ? (sc.mapping.ignored ? IGNORE : (sc.mapping.catalog_category_id ?? '')) : '';
              const suggested = sc.suggestion ? flat.find((c) => c.id === sc.suggestion) : undefined;
              return (
                <li key={sc.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{sc.name}</p>
                    <p className="text-xs text-muted">
                      {siteCode(sc.source_site_id)} · {sc.active_products} aktif / {sc.products} ürün
                    </p>
                  </div>
                  {suggested && canWrite && (
                    <Button variant="ghost" className="h-8 px-2 text-xs" busy={action.busy} onClick={() => void map(sc, suggested.id)}>
                      Öneri: {suggested.path}
                    </Button>
                  )}
                  <SelectField
                    label={`${sc.name} için platform kategorisi`}
                    className="shrink-0 sm:w-64"
                    value={current}
                    disabled={!canWrite || action.busy}
                    onChange={(v) => v && void map(sc, v)}
                    placeholder="— eşlenmedi —"
                    options={[...active.map((c) => ({ value: c.id, label: c.path })), { value: IGNORE, label: 'Yok say (eşleme)' }]}
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

function CategoryRow({
  category,
  canWrite,
  onChanged,
}: {
  category: Category & { depth: number };
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const action = useAction();
  const patch = async (body: Record<string, unknown>) => {
    const r = await action.run(() =>
      api(`/admin/v1/catalog/categories/${category.id}`, { method: 'PATCH', body: { version: category.version, ...body } }),
    );
    if (r.ok) {
      setEditing(false);
      await onChanged();
    }
  };
  return (
    <li style={{ paddingLeft: `${category.depth * 1.25}rem` }}>
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ name });
          }}
        >
          <input
            aria-label="Kategori adı"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 flex-1 rounded border border-line bg-surface px-2"
            autoFocus
          />
          <Button type="submit" className="h-8 px-2" busy={action.busy}>
            Kaydet
          </Button>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => setEditing(false)}>
            Vazgeç
          </Button>
        </form>
      ) : (
        <div className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
          <span className={category.status === 'archived' ? 'text-muted line-through' : ''}>{category.name}</span>
          <span className="text-xs text-muted">{category.product_count}</span>
          {category.status === 'archived' && <Badge>arşiv</Badge>}
          {canWrite && (
            <span className="ml-auto hidden gap-1 group-focus-within:flex group-hover:flex">
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => setEditing(true)}>
                Yeniden adlandır
              </button>
              <button
                type="button"
                className="text-xs text-muted hover:underline"
                onClick={() => void patch({ status: category.status === 'active' ? 'archived' : 'active' })}
              >
                {category.status === 'active' ? 'Arşivle' : 'Geri al'}
              </button>
            </span>
          )}
        </div>
      )}
      {action.error && <p className="text-xs text-danger">{action.error}</p>}
    </li>
  );
}

function NewCategory({ parents, onCreated }: { parents: (Category & { path: string })[]; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const action = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() => api('/admin/v1/catalog/categories', { method: 'POST', body: { name, parent_id: parent || null } }));
    if (r.ok) {
      setName('');
      await onCreated();
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-2 border-t border-line pt-4">
      <Field label="Yeni kategori" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      <SelectField
        label="Üst kategori"
        value={parent}
        onChange={setParent}
        placeholder="Ana kategori (üstü yok)"
        options={parents.map((c) => ({ value: c.id, label: c.path }))}
      />
      {action.error && <Alert>{action.error}</Alert>}
      <Button type="submit" busy={action.busy}>
        <Plus className="size-4" aria-hidden />
        Ekle
      </Button>
    </form>
  );
}
