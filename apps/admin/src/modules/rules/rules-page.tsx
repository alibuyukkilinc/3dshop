import { RefreshCw, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, PageHeader, type Tone } from '../../shared/ui';
import { NewRuleForm } from './new-rule-form';

interface Rule {
  id: string;
  code: string;
  name: string;
  layer: Layer;
  effect: 'allow' | 'deny' | 'boost' | 'demote';
  condition: unknown;
  priority: number;
  legal_ref: string | null;
  reason: string | null;
  status: 'draft' | 'active' | 'archived';
  system: boolean;
  targets: { type: string; id: string | null; include: boolean }[];
  channels: string[];
}
type Layer = 'mandatory_block' | 'exception' | 'normal' | 'default';
interface Summary {
  channel: string;
  target_type: string;
  visible: boolean;
  count: number;
}
interface ProductHit {
  id: string;
  name: string;
  external_id: string;
  sku: string | null;
  status: string;
}
interface Explain {
  channel: string;
  visible: boolean;
  layer: Layer | null;
  decided_by: {
    code: string;
    name?: string;
    reason?: string | null;
    legal_ref?: string | null;
  } | null;
  steps: {
    rule: string;
    name: string;
    layer: Layer;
    effect: string;
    applies: boolean;
    specificity: number;
    note?: string;
  }[];
  facts: Record<string, unknown>;
  in_sync: boolean;
}

export const CHANNELS = ['2d', 'search', '3d', 'ai', 'seo', 'ads', 'campaign'] as const;
const CHANNEL_NAME: Record<string, string> = {
  '2d': '2D vitrin',
  search: 'Arama',
  '3d': '3D dünya',
  ai: 'AI rehber',
  seo: 'SEO',
  ads: 'Reklam',
  campaign: 'Kampanya',
};
const LAYER: Record<Layer, [string, Tone]> = {
  mandatory_block: ['Hukuki engel', 'danger'],
  exception: ['İstisna', 'warn'],
  normal: ['Normal', 'accent'],
  default: ['Varsayılan', 'muted'],
};
const EFFECT: Record<Rule['effect'], string> = {
  allow: 'göster',
  deny: 'gizle',
  boost: 'öne çıkar',
  demote: 'geri it',
};

/** Görünürlük kuralları ve "neden görünmüyor?" (F2.1, K43). Kural yazımı yayın akışıyla gelir (F2.2). */
export function RulesPage({ canWrite, canPrepare }: { canWrite: boolean; canPrepare: boolean }) {
  const [creating, setCreating] = useState(false);
  const rules = useResource<{ ruleset_version: number; summary: Summary[]; items: Rule[] }>(
    '/admin/v1/rules',
  );
  const recompute = useAction();
  const visibleProducts = (ch: string) =>
    rules.data?.summary.find((s) => s.channel === ch && s.target_type === 'product' && s.visible)
      ?.count ?? 0;
  const totalProducts = (ch: string) =>
    rules.data?.summary
      .filter((s) => s.channel === ch && s.target_type === 'product')
      .reduce((a, s) => a + s.count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Görünürlük kuralları"
        description="Katman sırası: hukuki engel → istisna → normal → varsayılan. Aynı katmanda daha özgül hedef kazanır; eşitlikte gizleme kazanır. Hukuki engel hiçbir şekilde aşılamaz."
        actions={
          <>
            {canPrepare && !creating && (
              <Button onClick={() => setCreating(true)}>Yeni kural</Button>
            )}
            {canWrite && (
              <Button
                variant="ghost"
                busy={recompute.busy}
                onClick={async () => {
                  if (
                    (
                      await recompute.run(() =>
                        api('/admin/v1/rules/recompute', { method: 'POST' }),
                      )
                    ).ok
                  )
                    await rules.reload();
                }}
              >
                <RefreshCw className="size-4" aria-hidden />
                Yeniden hesapla
              </Button>
            )}
          </>
        }
      />
      {creating && <NewRuleForm isPlatformAdmin={canWrite} onCancel={() => setCreating(false)} />}
      {(rules.error || recompute.error) && (
        <div className="mt-4">
          <Alert>{rules.error ?? recompute.error}</Alert>
        </div>
      )}
      {rules.data && (
        <>
          <ul className="mt-6 grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {CHANNELS.map((ch) => (
              <li key={ch} className="rounded-lg border border-line bg-surface p-3">
                <p className="text-xs text-muted">{CHANNEL_NAME[ch]}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {visibleProducts(ch)}
                  <span className="text-sm font-normal text-muted"> / {totalProducts(ch)}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Görünen / toplam ürün · kural seti sürümü {rules.data.ruleset_version}
          </p>

          <section aria-labelledby="rules-title" className="mt-8">
            <h2 id="rules-title" className="font-semibold">
              Kurallar
            </h2>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {rules.data.items.map((r) => (
                <li key={r.id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={LAYER[r.layer][1]}>{LAYER[r.layer][0]}</Badge>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted">
                      {EFFECT[r.effect]} ·{' '}
                      {r.channels.length
                        ? r.channels.map((c) => CHANNEL_NAME[c] ?? c).join(', ')
                        : 'tüm kanallar'}
                      {r.targets.length > 0 &&
                        ` · ${r.targets.map((t) => `${t.include ? '' : 'hariç '}${t.type}${t.id ? '' : ' (tümü)'}`).join(', ')}`}
                    </span>
                    {r.system && <Badge>sistem</Badge>}
                    {r.status !== 'active' && <Badge tone="muted">{r.status}</Badge>}
                    <code className="ml-auto text-xs text-muted">{r.code}</code>
                  </div>
                  {r.reason && <p className="mt-1 text-xs text-muted">{r.reason}</p>}
                  {r.legal_ref && (
                    <p className="mt-1 text-xs text-danger">Dayanak: {r.legal_ref}</p>
                  )}
                  {r.condition !== null && (
                    <code className="mt-1 block text-xs break-all text-muted">
                      koşul: {JSON.stringify(r.condition)}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <ExplainSection />
    </>
  );
}

function ExplainSection() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [picked, setPicked] = useState<ProductHit | null>(null);
  const [results, setResults] = useState<Explain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setHits(
        (
          await api<{ items: ProductHit[] }>(
            `/admin/v1/catalog/products?q=${encodeURIComponent(q)}&limit=10`,
          )
        ).items,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Arama yapılamadı.');
    }
  }

  async function explain(p: ProductHit) {
    setPicked(p);
    setBusy(true);
    setError(null);
    try {
      setResults(
        await Promise.all(
          CHANNELS.map((ch) =>
            api<Explain>(
              `/admin/v1/rules/explain?target_type=product&target_id=${p.id}&channel=${ch}`,
            ),
          ),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Açıklama alınamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="explain-title"
      className="mt-8 rounded-lg border border-line bg-surface p-4"
    >
      <h2 id="explain-title" className="font-semibold">
        Neden görünmüyor?
      </h2>
      <form onSubmit={(e) => void search(e)} className="mt-3 flex gap-2">
        <label htmlFor="explain-q" className="sr-only">
          Ürün ara
        </label>
        <input
          id="explain-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ürün adı, SKU ya da kaynak kimliği"
          className="h-10 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
        <Button type="submit">
          <Search className="size-4" aria-hidden />
          Ara
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {hits && !picked && (
        <ul className="mt-3 divide-y divide-line text-sm">
          {hits.length === 0 && <li className="py-2 text-muted">Ürün bulunamadı.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full py-2 text-left hover:text-accent"
                onClick={() => void explain(h)}
              >
                {h.name}{' '}
                <span className="text-xs text-muted">
                  #{h.external_id} · {h.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <p className="font-medium">{picked.name}</p>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => (setPicked(null), setResults(null))}
            >
              başka ürün
            </button>
          </div>
          {busy && <p className="mt-2 text-sm text-muted">Değerlendiriliyor…</p>}
          {results && (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Kanal</th>
                  <th className="py-1 font-medium">Sonuç</th>
                  <th className="py-1 font-medium">Karar veren</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.channel} className="border-t border-line align-top">
                    <td className="py-2">{CHANNEL_NAME[r.channel]}</td>
                    <td className="py-2">
                      <Badge tone={r.visible ? 'ok' : 'danger'}>
                        {r.visible ? 'Görünür' : 'Gizli'}
                      </Badge>
                      {!r.in_sync && <span className="ml-2 text-xs text-warn">hesap bekliyor</span>}
                    </td>
                    <td className="py-2">
                      {r.decided_by ? (
                        <>
                          {r.layer && <Badge tone={LAYER[r.layer][1]}>{LAYER[r.layer][0]}</Badge>}{' '}
                          {r.decided_by.name ?? r.decided_by.code}
                          {r.decided_by.legal_ref && (
                            <p className="text-xs text-danger">Dayanak: {r.decided_by.legal_ref}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">karar veren kural yok (gizli)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {results?.[0] && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted">
                Olgular ve değerlendirilen kurallar (2D)
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-surface-2 p-2">
                {JSON.stringify(results[0].facts, null, 2)}
              </pre>
              <ul className="mt-2 space-y-0.5">
                {results[0].steps.map((s) => (
                  <li key={s.rule}>
                    {s.applies ? '✓' : '·'} {s.name} ({LAYER[s.layer][0]},{' '}
                    {EFFECT[s.effect as Rule['effect']] ?? s.effect}
                    {s.note ? `, ${s.note}` : ''})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
