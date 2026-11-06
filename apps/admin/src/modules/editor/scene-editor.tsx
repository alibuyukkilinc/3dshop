import { createGltfMeshLoader } from '@dtd/engine-three';
import { type SceneDocument, type SceneNode, SceneDocumentSchema } from '@dtd/scene-runtime';
import { ArrowLeft, Box, Flag, Move3d, RotateCw, Save, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { useResource } from '../../shared/data';
import { Alert, Badge, Button, SelectField, cn } from '../../shared/ui';
import { openChangeset } from '../publishing/changesets-page';
import { EditorEngine, type Mode } from './editor-engine';

interface AssetItem {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  status: string;
  current_version_id: string | null;
  license: { type: string; verified: boolean } | null;
  license_exception: boolean;
  latest: { triangles: number | null; lod0_bytes: number | null } | null;
}
interface Versions {
  scene: { id: string; name: string; owner_type: string; live_version_id: string | null };
  items: { id: string; number: number; note: string | null; created_at: string; live: boolean }[];
}
interface World {
  transit_lines: { stations: { place_id: string; name: string }[] }[];
}
interface Company {
  stores: { id: string; name: string; status: string }[];
}

type V3 = [number, number, number];
type Q = [number, number, number, number];

/** Varlık sürümü → LOD dosya adresi (tek sorguda önbellekli) */
function useMeshLoader() {
  return useMemo(() => {
    const keys = new Map<string, Promise<Record<string, string>>>();
    return createGltfMeshLoader(async (versionId, lod) => {
      let p = keys.get(versionId);
      if (!p) {
        p = api<Record<string, Record<string, string>>>(
          `/admin/v1/assets/files?version_ids=${versionId}`,
        ).then((r) => r[versionId] ?? {});
        keys.set(versionId, p);
      }
      const k = (await p)[lod] ?? (await p).lod0;
      return k ? `/api/v1/assets/files/${k}` : null;
    });
  }, []);
}

const yawDeg = (r: Q) => Math.round((2 * Math.atan2(r[1], r[3]) * 180) / Math.PI);
const yawQuat = (deg: number): Q => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.round(Math.sin(h) * 1e4) / 1e4, 0, Math.round(Math.cos(h) * 1e4) / 1e4];
};
const shortId = () => Math.random().toString(36).slice(2, 8);
/** Varlığın birimi metre değilse "scale:N" etiketi (Kenney: 10) */
const unitScale = (tags: string[]) => Number(tags.find((t) => t.startsWith('scale:'))?.slice(6)) || 1;

/**
 * Temel şehir editörü (F3.4): varlık yerleştir, taşı/döndür, yuva/durak/mağaza girişi çapası; taslak sürüm
 * kaydet; yayın için değişiklik seti aç (K44). Belge dtd.scene.v1 (motor bağımsız, K45).
 */
export function SceneEditor({ sceneId, canEdit }: { sceneId: string; canEdit: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const meshLoader = useMeshLoader();
  const versions = useResource<Versions>(`/admin/v1/scenes/${sceneId}/versions`);
  const assets = useResource<{ items: AssetItem[] }>('/admin/v1/assets?status=ready');
  const worlds = useResource<{ items: World[] }>('/admin/v1/world/worlds');
  const companies = useResource<{ items: Company[] }>('/admin/v1/commerce/companies');
  const [doc, setDoc] = useState<SceneDocument | null>(null);
  const [base, setBase] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('translate');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ drawCalls: number; triangles: number } | null>(null);

  // Belgeyi yükle
  useEffect(() => {
    void api<{ number: number; document: unknown }>(`/admin/v1/scenes/${sceneId}/document`).then(
      (d) => {
        const parsed = SceneDocumentSchema.parse(d.document);
        setDoc(parsed);
        setBase(d.number);
        // Bölge sahnesi dünya koordinatında: kamerayı zemine odakla
        const ground = parsed.nodes.find((n) => n.id === 'zemin');
        if (ground) setTimeout(() => engineRef.current?.focus(ground.transform.p as V3), 0);
      },
      (e) => setError(e instanceof ApiError ? e.message : 'Sahne yüklenemedi.'),
    );
  }, [sceneId]);

  // Motoru bir kez kur
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new EditorEngine(canvasRef.current, meshLoader);
    engine.onSelect = setSelected;
    engine.onTransformEnd = (id, p, r) => {
      setDoc((d) =>
        d
          ? {
              ...d,
              nodes: d.nodes.map((n) =>
                n.id === id ? { ...n, transform: { ...n.transform, p, r } } : n,
              ),
            }
          : d,
      );
      setDirty(true);
    };
    engineRef.current = engine;
    const t = setInterval(() => setStats(engine.stats()), 1000);
    return () => {
      clearInterval(t);
      engine.dispose();
      engineRef.current = null;
    };
  }, [meshLoader]);

  // Yapısal değişiklikte sahneyi yeniden kur (dönüşüm sürüklemesi zaten nesnede)
  const structureKey = useMemo(
    () =>
      doc
        ? JSON.stringify(doc.nodes.map((n) => [n.id, n.parent, n.components, n.transform.s]))
        : '',
    [doc],
  );
  useEffect(() => {
    if (doc && engineRef.current) void engineRef.current.setDocument(doc);
    // Bilerek yalnız yapı anahtarına bağlı: sürükleme sonrası dönüşüm güncellemesi sahneyi yeniden kurmaz
  }, [structureKey]);
  useEffect(() => engineRef.current?.setMode(mode), [mode]);

  const update = useCallback((id: string, fn: (n: SceneNode) => SceneNode, rebuild = false) => {
    setDoc((d) => {
      if (!d) return d;
      const next = { ...d, nodes: d.nodes.map((n) => (n.id === id ? fn(n) : n)) };
      if (rebuild) void engineRef.current?.setDocument(next);
      return next;
    });
    setDirty(true);
  }, []);

  function addNode({ scale = 1, ...node }: Omit<SceneNode, 'transform'> & { scale?: number }) {
    if (!doc || !engineRef.current) return;
    const p = engineRef.current.groundCenter();
    const n = { ...node, transform: { p, r: [0, 0, 0, 1], s: [scale, scale, scale] } } as SceneNode;
    setDoc({ ...doc, nodes: [...doc.nodes, n] });
    setDirty(true);
    setTimeout(() => engineRef.current?.select(n.id), 50);
  }

  function remove(id: string) {
    if (!doc) return;
    const gone = new Set([id]);
    for (const n of doc.nodes) if (n.parent && gone.has(n.parent)) gone.add(n.id);
    setDoc({ ...doc, nodes: doc.nodes.filter((n) => !gone.has(n.id)) });
    setDirty(true);
    engineRef.current?.select(null);
  }

  async function save(): Promise<string | null> {
    if (!doc) return null;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ version_id: string; number: number; unchanged: boolean }>(
        `/admin/v1/scenes/${sceneId}/versions`,
        {
          method: 'POST',
          body: { base_number: base, document: doc },
        },
      );
      setBase(r.number);
      setDirty(false);
      setNotice(r.unchanged ? 'Değişiklik yok.' : `Sürüm ${r.number} kaydedildi.`);
      await versions.reload();
      return r.version_id;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Kaydedilemedi.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const versionId = dirty
      ? await save()
      : (versions.data?.items.find((v) => v.number === base)?.id ?? null);
    if (!versionId) return;
    try {
      await openChangeset(`Sahne yayını: ${versions.data?.scene.name ?? ''} v${base}`, [
        {
          entity_type: 'scene',
          entity_id: sceneId,
          op: 'publish',
          payload: { version_id: versionId },
        },
      ]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Değişiklik seti açılamadı.');
    }
  }

  const node = doc?.nodes.find((n) => n.id === selected) ?? null;
  const stations =
    worlds.data?.items.flatMap((w) => w.transit_lines.flatMap((l) => l.stations)) ?? [];
  const stores = companies.data?.items.flatMap((c) => c.stores) ?? [];
  const palette = (assets.data?.items ?? []).filter(
    (a) =>
      a.current_version_id &&
      (!filter || a.name.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr'))),
  );

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <a
          href="#/world"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> Mekân
        </a>
        <h1 className="font-semibold">{versions.data?.scene.name ?? 'Sahne'}</h1>
        <Badge>sürüm {base}</Badge>
        {dirty && <Badge tone="warn">kaydedilmedi</Badge>}
        {versions.data?.items.find((v) => v.live) && (
          <Badge tone="ok">yayında: v{versions.data.items.find((v) => v.live)!.number}</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={mode === 'translate' ? 'primary' : 'ghost'}
            className="h-8 px-2"
            onClick={() => setMode('translate')}
            title="Taşı (G)"
          >
            <Move3d className="size-4" aria-hidden />
            <span className="sr-only">Taşı</span>
          </Button>
          <Button
            variant={mode === 'rotate' ? 'primary' : 'ghost'}
            className="h-8 px-2"
            onClick={() => setMode('rotate')}
            title="Döndür (R)"
          >
            <RotateCw className="size-4" aria-hidden />
            <span className="sr-only">Döndür</span>
          </Button>
          {canEdit && (
            <>
              <Button
                className="h-8 px-3"
                busy={busy}
                disabled={!dirty}
                onClick={() => void save()}
              >
                <Save className="size-4" aria-hidden /> Kaydet
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-3"
                busy={busy}
                onClick={() => void publish()}
              >
                <Send className="size-4" aria-hidden /> Yayın için set aç
              </Button>
            </>
          )}
        </div>
      </div>
      {(error || notice) && (
        <div className="mt-2">
          {error ? <Alert>{error}</Alert> : <Alert tone="ok">{notice}</Alert>}
        </div>
      )}

      <div className="mt-2 grid min-h-0 flex-1 gap-2 lg:grid-cols-[15rem_1fr_16rem]">
        <aside
          aria-label="Yerleştirilecekler"
          className="flex min-h-0 flex-col rounded-lg border border-line bg-surface p-2 text-sm"
        >
          <p className="text-xs font-semibold text-muted uppercase">İşaretler</p>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              disabled={!canEdit}
              className="rounded border border-line px-2 py-1 text-left hover:border-accent"
              onClick={() =>
                addNode({
                  id: `yuva-${shortId()}`,
                  parent: null,
                  name: 'Vitrin yuvası',
                  components: [{ type: 'slot', slot_id: `slot-${shortId()}` }],
                })
              }
            >
              <Flag className="inline size-3 text-[#f59e0b]" aria-hidden /> Yuva
            </button>
            <button
              type="button"
              disabled={!canEdit}
              className="rounded border border-line px-2 py-1 text-left hover:border-accent"
              onClick={() =>
                addNode({
                  id: `kutu-${shortId()}`,
                  parent: null,
                  name: 'Kutu',
                  components: [
                    {
                      type: 'primitive',
                      shape: 'box',
                      size: [4, 3, 4],
                      material: { color: '#cbd5e1', roughness: 0.8, metalness: 0 },
                      castShadow: true,
                      receiveShadow: true,
                    },
                  ],
                })
              }
            >
              <Box className="inline size-3" aria-hidden /> Kutu
            </button>
            <button
              type="button"
              disabled={!canEdit || stations.length === 0}
              className="rounded border border-line px-2 py-1 text-left hover:border-accent"
              onClick={() =>
                addNode({
                  id: `durak-${shortId()}`,
                  parent: null,
                  name: 'Tramvay durağı',
                  components: [{ type: 'anchor', kind: 'station', ref_id: stations[0]!.place_id }],
                })
              }
            >
              <Flag className="inline size-3 text-[#06b6d4]" aria-hidden /> Durak
            </button>
            <button
              type="button"
              disabled={!canEdit || stores.length === 0}
              className="rounded border border-line px-2 py-1 text-left hover:border-accent"
              onClick={() =>
                addNode({
                  id: `giris-${shortId()}`,
                  parent: null,
                  name: 'Mağaza girişi',
                  components: [{ type: 'anchor', kind: 'store_entrance', ref_id: stores[0]!.id }],
                })
              }
            >
              <Flag className="inline size-3 text-[#06b6d4]" aria-hidden /> Giriş
            </button>
          </div>
          <p className="mt-3 text-xs font-semibold text-muted uppercase">Varlıklar</p>
          <label className="sr-only" htmlFor="varlik-ara">
            Varlık ara
          </label>
          <input
            id="varlik-ara"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Ara: building, parasol…"
            className="mt-1 h-8 rounded border border-line bg-surface px-2"
          />
          <ul className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {palette.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={!canEdit}
                  className="w-full rounded px-2 py-1 text-left hover:bg-surface-2"
                  title={`${a.latest?.triangles ?? '?'} üçgen · ${Math.round((a.latest?.lod0_bytes ?? 0) / 1024)} KB`}
                  onClick={() =>
                    addNode({
                      id: `${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${shortId()}`,
                      parent: null,
                      name: a.name,
                      components: [
                        {
                          type: 'mesh',
                          asset_version_id: a.current_version_id!,
                          lod_policy: 'auto',
                        },
                      ],
                      scale: unitScale(a.tags),
                    })
                  }
                >
                  {a.name}
                  {!a.license?.verified && !a.license_exception && (
                    <span className="ml-1 text-xs text-warn">lisans?</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="relative min-h-[20rem] overflow-hidden rounded-lg border border-line bg-black">
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            aria-label="Sahne görünümü: sol tık seç, sürükle döndür, sağ tık kaydır, tekerlek yakınlaştır"
          />
          {stats && (
            <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
              {doc?.nodes.length ?? 0} düğüm · {stats.drawCalls} çizim ·{' '}
              {Math.round(stats.triangles / 1000)} bin üçgen
            </p>
          )}
        </div>

        <aside
          aria-label="Seçili düğüm"
          className="overflow-y-auto rounded-lg border border-line bg-surface p-3 text-sm"
        >
          {!node && (
            <p className="text-muted">
              Bir nesne seçin. Tıkla seç; tutamakla taşı/döndür (ızgara 1 m, açı 15°).
            </p>
          )}
          {node && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-muted">Ad</span>
                <input
                  value={node.name ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => update(node.id, (n) => ({ ...n, name: e.target.value }))}
                  className="mt-0.5 h-8 w-full rounded border border-line bg-surface px-2"
                />
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as const).map((axis, i) => (
                  <label key={axis} className="block">
                    <span className="text-xs text-muted">{axis} (m)</span>
                    <input
                      type="number"
                      step="0.5"
                      disabled={!canEdit}
                      value={node.transform.p[i]}
                      onChange={(e) => {
                        const p = [...node.transform.p] as V3;
                        p[i] = Number(e.target.value);
                        update(node.id, (n) => ({ ...n, transform: { ...n.transform, p } }), true);
                      }}
                      className="mt-0.5 h-8 w-full rounded border border-line bg-surface px-1"
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1">
                <label className="block">
                  <span className="text-xs text-muted">Yön (°)</span>
                  <input
                    type="number"
                    step="15"
                    disabled={!canEdit}
                    value={yawDeg(node.transform.r as Q)}
                    onChange={(e) =>
                      update(
                        node.id,
                        (n) => ({
                          ...n,
                          transform: { ...n.transform, r: yawQuat(Number(e.target.value)) },
                        }),
                        true,
                      )
                    }
                    className="mt-0.5 h-8 w-full rounded border border-line bg-surface px-1"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Ölçek</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    disabled={!canEdit}
                    value={node.transform.s[0]}
                    onChange={(e) => {
                      const v = Math.max(0.1, Number(e.target.value));
                      update(
                        node.id,
                        (n) => ({ ...n, transform: { ...n.transform, s: [v, v, v] } }),
                        true,
                      );
                    }}
                    className="mt-0.5 h-8 w-full rounded border border-line bg-surface px-1"
                  />
                </label>
              </div>
              {node.components.map((c, ci) => (
                <div key={ci} className="rounded border border-line p-2">
                  <p className="text-xs font-semibold">
                    {c.type === 'mesh'
                      ? 'Varlık'
                      : c.type === 'slot'
                        ? 'Vitrin yuvası'
                        : c.type === 'anchor'
                          ? 'Çapa'
                          : c.type}
                  </p>
                  {c.type === 'slot' && <code className="text-xs text-muted">{c.slot_id}</code>}
                  {c.type === 'anchor' && c.kind === 'station' && (
                    <SelectField
                      label="Durak"
                      value={c.ref_id}
                      disabled={!canEdit}
                      onChange={(v) =>
                        update(node.id, (n) => ({
                          ...n,
                          components: n.components.map((x, j) =>
                            j === ci ? { ...x, ref_id: v } : x,
                          ),
                        }))
                      }
                      options={stations.map((s) => ({ value: s.place_id, label: s.name }))}
                    />
                  )}
                  {c.type === 'anchor' && c.kind === 'store_entrance' && (
                    <SelectField
                      label="Mağaza"
                      value={c.ref_id}
                      disabled={!canEdit}
                      onChange={(v) =>
                        update(node.id, (n) => ({
                          ...n,
                          components: n.components.map((x, j) =>
                            j === ci ? { ...x, ref_id: v } : x,
                          ),
                        }))
                      }
                      options={stores.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  )}
                  {c.type === 'mesh' && (
                    <code className="block truncate text-xs text-muted">{c.asset_version_id}</code>
                  )}
                </div>
              ))}
              {canEdit && node.id !== 'zemin' && (
                <Button
                  variant="ghost"
                  className={cn('h-8 px-2 text-danger')}
                  onClick={() => remove(node.id)}
                >
                  <Trash2 className="size-4" aria-hidden /> Sil
                </Button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default SceneEditor;
