import { type FormEvent, useState } from 'react';
import { api } from '../../shared/api';
import { useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, Field, PageHeader } from '../../shared/ui';

interface Store {
  id: string;
  name: string;
  slug: string;
  store_type: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  source_site_ids: string[];
}
interface Company {
  id: string;
  legal_name: string;
  display_name: string;
  tax_number: string | null;
  website: string | null;
  version: number;
  stores: Store[];
}
interface Source {
  id: string;
  code: string;
}

const STORE_STATUS = { draft: 'Taslak', active: 'Yayında', archived: 'Arşiv' } as const;

/** Firma ve mağaza bilgileri (F1.3). Her kaydetme denetim kaydına yazılır. */
export function StoresPage({ canWrite }: { canWrite: boolean }) {
  const companies = useResource<{ items: Company[] }>('/admin/v1/commerce/companies');
  const sources = useResource<{ items: Source[] }>('/admin/v1/integration/sources');
  const siteCode = (id: string) => sources.data?.items.find((s) => s.id === id)?.code ?? id.slice(0, 8);

  return (
    <>
      <PageHeader
        title="Firmalar ve mağazalar"
        description="Pilotta her kaynak site bir firma ve bir mağazadır. Firma adı ve vergi bilgisi buradan düzeltilir; kaynak sitedeki ayar kullanılmaz."
      />
      {companies.error && (
        <div className="mt-4">
          <Alert>{companies.error}</Alert>
        </div>
      )}
      <ul className="mt-6 space-y-4">
        {companies.data?.items.map((c) => (
          <li key={c.id} className="rounded-lg border border-line bg-surface p-4">
            <CompanyForm company={c} canWrite={canWrite} onSaved={companies.reload} />
            <ul className="mt-4 space-y-3 border-t border-line pt-4">
              {c.stores.map((s) => (
                <li key={s.id}>
                  <StoreForm store={s} canWrite={canWrite} onSaved={companies.reload} sites={s.source_site_ids.map(siteCode)} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

function CompanyForm({ company, canWrite, onSaved }: { company: Company; canWrite: boolean; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    display_name: company.display_name,
    legal_name: company.legal_name,
    tax_number: company.tax_number ?? '',
    website: company.website ?? '',
  });
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const dirty =
    form.display_name !== company.display_name ||
    form.legal_name !== company.legal_name ||
    form.tax_number !== (company.tax_number ?? '') ||
    form.website !== (company.website ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const r = await action.run(() =>
      api(`/admin/v1/commerce/companies/${company.id}`, {
        method: 'PATCH',
        body: {
          version: company.version,
          display_name: form.display_name,
          legal_name: form.legal_name,
          tax_number: form.tax_number.trim() || null,
          website: form.website.trim() || null,
        },
      }),
    );
    if (r.ok) {
      setSaved(true);
      await onSaved();
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Firma</p>
      <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2">
        <Field label="Görünen ad" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
        <Field label="Ticari ünvan" value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} required />
        <Field
          label="Vergi / TC kimlik no"
          inputMode="numeric"
          value={form.tax_number}
          onChange={(e) => setForm({ ...form, tax_number: e.target.value })}
          hint="VKN 10, TCKN 11 hane. Bilinmiyorsa boş bırakın."
        />
        <Field label="Web sitesi" type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      </fieldset>
      {action.error && <Alert>{action.error}</Alert>}
      {saved && !dirty && <Alert tone="ok">Kaydedildi.</Alert>}
      {canWrite && dirty && (
        <Button type="submit" busy={action.busy}>
          Firmayı kaydet
        </Button>
      )}
    </form>
  );
}

function StoreForm({
  store,
  canWrite,
  onSaved,
  sites,
}: {
  store: Store;
  canWrite: boolean;
  onSaved: () => Promise<void>;
  sites: string[];
}) {
  const [name, setName] = useState(store.name);
  const [slug, setSlug] = useState(store.slug);
  const action = useAction();
  const dirty = name !== store.name || slug !== store.slug;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() =>
      api(`/admin/v1/commerce/stores/${store.id}`, {
        method: 'PATCH',
        body: { version: store.version, name, ...(slug !== store.slug && { slug }) },
      }),
    );
    if (r.ok) await onSaved();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Mağaza</p>
        <Badge tone={store.status === 'active' ? 'ok' : 'muted'}>{STORE_STATUS[store.status]}</Badge>
        {sites.map((s) => (
          <Badge key={s} tone="accent">
            kaynak: {s}
          </Badge>
        ))}
      </div>
      <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2">
        <Field label="Mağaza adı" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field
          label="Adres (slug)"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          disabled={store.status !== 'draft'}
          hint={store.status === 'draft' ? 'Kalıcı adres: küçük harf, rakam ve tire.' : 'Yayındaki mağazanın adresi değiştirilemez.'}
        />
      </fieldset>
      {action.error && <Alert>{action.error}</Alert>}
      {canWrite && dirty && (
        <Button type="submit" busy={action.busy}>
          Mağazayı kaydet
        </Button>
      )}
    </form>
  );
}
