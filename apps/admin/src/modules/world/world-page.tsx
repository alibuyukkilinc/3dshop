import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { useResource } from '../../shared/data';
import { Alert, Badge, Button, Field, PageHeader, SelectField } from '../../shared/ui';
import { openChangeset } from '../publishing/changesets-page';

interface World {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  regions: { id: string; slug: string; name: string; kind: string; scene_id: string | null }[];
  transit_lines: {
    id: string;
    code: string;
    name: string;
    stations: { place_id: string; name: string }[];
  }[];
}
interface Branch {
  place_id: string;
  store_id: string | null;
  name: string;
  geo: {
    lat: number;
    lng: number;
    precision: 'exact' | 'street' | 'district_center' | 'province_center';
    source: string;
    address_line: string | null;
    province: string | null;
    district: string | null;
    verified_at: string | null;
  } | null;
}

const PRECISION = {
  exact: 'Tam adres',
  street: 'Sokak',
  district_center: 'İlçe merkezi',
  province_center: 'İl merkezi',
} as const;
const TYPE: Record<string, string> = {
  central_city: 'Merkezi şehir',
  turkey_map: 'Türkiye haritası',
  local_world: 'Yerel dünya',
  store_interior: 'Mağaza içi',
};

/** Mekân (F3.1): dünyalar, bölgeler, tramvay; şube pinleri (harita). */
/** Bölgenin sahnesini (yoksa boş başlangıçla) açıp editöre gider. */
async function openEditor(regionId: string, name: string) {
  const s = await api<{ id: string }>('/admin/v1/scenes', {
    method: 'POST',
    body: { owner_type: 'region', owner_id: regionId, name },
  });
  window.location.hash = `#/editor/${s.id}`;
}

export function WorldPage({ canPrepare }: { canPrepare: boolean }) {
  const worlds = useResource<{ items: World[] }>('/admin/v1/world/worlds');
  const branches = useResource<{ items: Branch[] }>('/admin/v1/world/branches');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Mekân"
        description="Şehir, bölgeler ve tramvay; gerçek şubelerin harita pinleri. Pilotta şube konumu ilçe merkezidir; gerçek adres girilince hassasiyet tam adres olur."
      />
      {(worlds.error || branches.error) && <Alert>{worlds.error ?? branches.error}</Alert>}
      {worlds.data?.items.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          Henüz dünya yok. Sunucuda <code>pnpm world -- seed-pilot</code> pilot şehri ve şube
          pinlerini kurar.
        </p>
      )}
      <ul className="mt-6 grid gap-3 md:grid-cols-2">
        {worlds.data?.items.map((w) => (
          <li key={w.id} className="rounded-lg border border-line bg-surface p-4 text-sm">
            <div className="flex items-center gap-2">
              <p className="font-medium">{w.name}</p>
              <Badge>{TYPE[w.type] ?? w.type}</Badge>
              <Badge tone={w.status === 'active' ? 'ok' : 'muted'}>{w.status}</Badge>
            </div>
            {w.regions.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {w.regions.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    {r.name} <span className="text-xs text-muted">{r.kind}</span>
                    {canPrepare && (
                      <button
                        type="button"
                        className="ml-auto text-xs text-accent hover:underline"
                        onClick={() => void openEditor(r.id, r.name)}
                      >
                        Sahneyi düzenle
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {w.transit_lines.map((l) => (
              <p key={l.id} className="mt-2 text-xs text-muted">
                {l.name}: {l.stations.length} durak
              </p>
            ))}
          </li>
        ))}
      </ul>

      <section aria-labelledby="pins-title" className="mt-8">
        <h2 id="pins-title" className="font-semibold">
          Şube pinleri
        </h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_20rem]">
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {branches.data?.items.map((b) => (
              <li key={b.place_id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.name}</span>
                  {b.geo && (
                    <>
                      <span className="text-muted">
                        {b.geo.district}, {b.geo.province}
                      </span>
                      <Badge tone={b.geo.precision === 'exact' ? 'ok' : 'warn'}>
                        {PRECISION[b.geo.precision]}
                      </Badge>
                      <a
                        className="text-xs text-accent hover:underline"
                        href={`https://www.openstreetmap.org/?mlat=${b.geo.lat}&mlon=${b.geo.lng}#map=13/${b.geo.lat}/${b.geo.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        haritada gör
                      </a>
                    </>
                  )}
                  {canPrepare && editing !== b.place_id && (
                    <button
                      type="button"
                      className="ml-auto text-xs text-accent hover:underline"
                      onClick={() => setEditing(b.place_id)}
                    >
                      Konumu düzelt…
                    </button>
                  )}
                </div>
                {editing === b.place_id && b.geo && (
                  <PinForm branch={b} onCancel={() => setEditing(null)} />
                )}
              </li>
            ))}
          </ul>
          <TurkeyDots branches={branches.data?.items ?? []} />
        </div>
      </section>
    </>
  );
}

function PinForm({ branch, onCancel }: { branch: Branch; onCancel: () => void }) {
  const g = branch.geo!;
  const [f, setF] = useState({
    lat: String(g.lat),
    lng: String(g.lng),
    precision: g.precision,
    address: g.address_line ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await openChangeset(`Şube konumu: ${branch.name}`, [
        {
          entity_type: 'map_pin',
          entity_id: branch.place_id,
          op: 'update',
          payload: {
            lat: Number(f.lat),
            lng: Number(f.lng),
            precision: f.precision,
            address_line: f.address || null,
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
    <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field
          label="Enlem"
          inputMode="decimal"
          value={f.lat}
          onChange={(e) => setF({ ...f, lat: e.target.value })}
          required
        />
        <Field
          label="Boylam"
          inputMode="decimal"
          value={f.lng}
          onChange={(e) => setF({ ...f, lng: e.target.value })}
          required
        />
      </div>
      <Field
        label="Adres"
        value={f.address}
        onChange={(e) => setF({ ...f, address: e.target.value })}
      />
      <label className="block text-sm">
        <span className="font-medium">Hassasiyet</span>
        <SelectField
          label="Hassasiyet"
          value={f.precision}
          onChange={(v) => setF({ ...f, precision: v as keyof typeof PRECISION })}
          options={Object.entries(PRECISION).map(([value, label]) => ({ value, label }))}
        />
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

/** Türkiye kutusunda pinlerin kaba yeri (harita katmanı F4'te). */
function TurkeyDots({ branches }: { branches: Branch[] }) {
  const [W, H] = [320, 150];
  const x = (lng: number) => ((lng - 25.6) / (44.9 - 25.6)) * W;
  const y = (lat: number) => H - ((lat - 35.8) / (42.2 - 35.8)) * H;
  return (
    <figure className="rounded-lg border border-line bg-surface p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Şubelerin Türkiye üzerindeki yaklaşık yerleri"
        className="w-full"
      >
        <rect x="0" y="0" width={W} height={H} rx="8" className="fill-surface-2" />
        {branches
          .filter((b) => b.geo)
          .map((b) => (
            <g key={b.place_id}>
              <circle cx={x(b.geo!.lng)} cy={y(b.geo!.lat)} r="4" className="fill-accent" />
              <text x={x(b.geo!.lng) + 6} y={y(b.geo!.lat) + 3} className="fill-current text-[8px]">
                {b.geo!.district}
              </text>
            </g>
          ))}
      </svg>
      <figcaption className="mt-1 text-xs text-muted">
        Yaklaşık konumlar (enlem/boylam kutusu)
      </figcaption>
    </figure>
  );
}
