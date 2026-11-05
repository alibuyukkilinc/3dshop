import { type FormEvent, useState } from 'react';
import { ApiError } from '../../shared/api';
import { Alert, Button, Field, SelectField } from '../../shared/ui';
import { openChangeset } from '../publishing/changesets-page';

const LAYERS = [
  ['normal', 'Normal'],
  ['exception', 'İstisna'],
  ['default', 'Varsayılan'],
  ['mandatory_block', 'Hukuki / KVKK engeli'],
] as const;
const EFFECTS = [
  ['deny', 'Gizle'],
  ['allow', 'Göster'],
  ['boost', 'Öne çıkar'],
  ['demote', 'Geri it'],
] as const;
const TARGETS = [
  'product',
  'category',
  'store',
  'brand',
  'company',
  'variant',
  'region',
  'world',
] as const;
const CHANNELS = [
  ['2d', '2D vitrin'],
  ['search', 'Arama'],
  ['3d', '3D dünya'],
  ['ai', 'AI rehber'],
  ['seo', 'SEO'],
  ['ads', 'Reklam'],
  ['campaign', 'Kampanya'],
] as const;

const toCode = (name: string) =>
  name
    .toLocaleUpperCase('tr')
    .replace(/[ÇĞİÖŞÜ]/g, (c) => ({ Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' })[c] ?? c)
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

/** Yeni kural: doğrudan canlıya çıkmaz, değişiklik seti açar (K44). */
export function NewRuleForm({
  isPlatformAdmin,
  onCancel,
}: {
  isPlatformAdmin: boolean;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: '',
    layer: 'normal',
    effect: 'deny',
    factor: '',
    priority: '0',
    targetType: 'product',
    targetId: '',
    channels: [] as string[],
    condition: '',
    legal_ref: '',
    reason: '',
    valid_from: '',
    valid_to: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let condition = null;
    if (f.condition.trim()) {
      try {
        condition = JSON.parse(f.condition);
      } catch {
        setError('Koşul geçerli JSON değil.');
        return;
      }
    }
    const payload = {
      code: toCode(f.name),
      name: f.name,
      layer: f.layer,
      effect: f.effect,
      effect_params: f.factor ? { factor: Number(f.factor) } : {},
      condition,
      priority: Number(f.priority) || 0,
      legal_ref: f.legal_ref || null,
      reason: f.reason || null,
      valid_from: f.valid_from ? new Date(f.valid_from).toISOString() : null,
      valid_to: f.valid_to ? new Date(f.valid_to).toISOString() : null,
      targets:
        f.targetType === 'world' && !f.targetId
          ? []
          : [{ type: f.targetType, id: f.targetId.trim() || null, include: true }],
      channels: f.channels,
    };
    setBusy(true);
    try {
      await openChangeset(`Kural: ${f.name}`, [{ entity_type: 'rule', op: 'create', payload }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kural kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4"
    >
      <h2 className="font-semibold">Yeni kural</h2>
      <p className="text-xs text-muted">
        Kaydedince bir değişiklik seti açılır; onay ve yayından sonra geçerli olur.
      </p>
      <Field
        label="Ad"
        value={f.name}
        onChange={(e) => set('name')(e.target.value)}
        required
        minLength={3}
        hint={f.name ? `Kod: ${toCode(f.name)}` : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium">Katman</span>
          <SelectField
            label="Katman"
            value={f.layer}
            onChange={set('layer')}
            options={LAYERS.filter(([v]) => v !== 'mandatory_block' || isPlatformAdmin).map(
              ([value, label]) => ({ value, label }),
            )}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">Etki</span>
          <SelectField
            label="Etki"
            value={f.effect}
            onChange={set('effect')}
            options={EFFECTS.map(([value, label]) => ({ value, label }))}
          />
        </label>
        <Field
          label="Öncelik"
          type="number"
          value={f.priority}
          onChange={(e) => set('priority')(e.target.value)}
        />
      </div>
      {(f.effect === 'boost' || f.effect === 'demote') && (
        <Field
          label="Katsayı"
          type="number"
          step="0.1"
          min="0.1"
          value={f.factor}
          onChange={(e) => set('factor')(e.target.value)}
          required
        />
      )}
      {f.layer === 'mandatory_block' && (
        <Field
          label="Hukuki dayanak"
          value={f.legal_ref}
          onChange={(e) => set('legal_ref')(e.target.value)}
          required
          hint="Mahkeme kararı, dilekçe ya da KVKK talep numarası. Hukuki engel hiçbir şekilde aşılamaz ve arşivlenemez."
        />
      )}
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="text-sm">
          <span className="font-medium">Hedef türü</span>
          <SelectField
            label="Hedef türü"
            value={f.targetType}
            onChange={set('targetType')}
            options={TARGETS.map((t) => ({ value: t, label: t }))}
          />
        </label>
        <Field
          label="Hedef kimliği"
          value={f.targetId}
          onChange={(e) => set('targetId')(e.target.value)}
          hint="Boş bırakılırsa bu türün tamamı. Ürün kimliği Kurallar → Neden görünmüyor? aramasından alınır."
        />
      </div>
      <fieldset className="text-sm">
        <legend className="font-medium">Kanallar (hiçbiri seçilmezse tümü)</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {CHANNELS.map(([v, l]) => (
            <label key={v} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={f.channels.includes(v)}
                onChange={(e) =>
                  setF({
                    ...f,
                    channels: e.target.checked
                      ? [...f.channels, v]
                      : f.channels.filter((c) => c !== v),
                  })
                }
              />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        <span className="font-medium">Koşul (isteğe bağlı, JSON)</span>
        <textarea
          value={f.condition}
          onChange={(e) => set('condition')(e.target.value)}
          rows={2}
          placeholder='{"fact": "product.stock", "op": "lte", "value": 0}'
          className="mt-1 w-full rounded-md border border-line bg-surface p-2 font-mono text-xs"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Geçerlilik başlangıcı"
          type="datetime-local"
          value={f.valid_from}
          onChange={(e) => set('valid_from')(e.target.value)}
        />
        <Field
          label="Geçerlilik bitişi"
          type="datetime-local"
          value={f.valid_to}
          onChange={(e) => set('valid_to')(e.target.value)}
        />
      </div>
      <Field label="Gerekçe" value={f.reason} onChange={(e) => set('reason')(e.target.value)} />
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
