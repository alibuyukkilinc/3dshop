import type { AdminMe } from '@dtd/contracts';
import { ArrowLeft, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../shared/api';
import { fmtDate, useAction, useResource } from '../../shared/data';
import { Alert, Badge, Button, PageHeader, SelectField, type Tone } from '../../shared/ui';

type Status =
  'draft' | 'in_review' | 'approved' | 'scheduled' | 'published' | 'rejected' | 'cancelled';
interface ChangesetSummary {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  created_by: string;
  created_at: string;
  approved_at: string | null;
  self_approved: boolean;
  self_approval_reason: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  rollback_of_id: string | null;
  rolled_back_by_id: string | null;
  last_error: string | null;
  item_count?: number;
}
interface Changeset extends ChangesetSummary {
  items: {
    id: string;
    entity_type: string;
    label: string;
    entity_id: string | null;
    op: string;
    payload: Record<string, unknown>;
    before: Record<string, unknown> | null;
  }[];
  approvals: {
    approver_id: string;
    decision: 'approve' | 'reject';
    comment: string | null;
    at: string;
  }[];
}

export const STATUS: Record<Status, [string, Tone]> = {
  draft: ['Taslak', 'muted'],
  in_review: ['İncelemede', 'accent'],
  approved: ['Onaylandı', 'ok'],
  scheduled: ['Zamanlandı', 'accent'],
  published: ['Yayında', 'ok'],
  rejected: ['Reddedildi', 'danger'],
  cancelled: ['İptal', 'muted'],
};
const OP: Record<string, string> = {
  publish: 'yayına al',
  unpublish: 'yayından kaldır (taslağa dön)',
  archive: 'arşivle',
  update: 'güncelle',
  create: 'oluştur',
  activate: 'etkinleştir',
};

/** Değişiklik setleri (F2.2, K44): taslak → inceleme → onay → yayın; her yayın geri alınabilir. */
export function ChangesetsPage({ me, id }: { me: AdminMe; id: string | null }) {
  return id ? <ChangesetDetail me={me} id={id} /> : <ChangesetList />;
}

function ChangesetList() {
  const [status, setStatus] = useState('');
  const list = useResource<{ items: ChangesetSummary[] }>(
    `/admin/v1/changesets${status ? `?status=${status}` : ''}`,
  );
  return (
    <>
      <PageHeader
        title="Yayın"
        description="Mağaza yayına alma ve görünürlük kuralları değişiklik setiyle canlıya çıkar. Onaylayan hazırlayandan farklı olmalı; başka onaylayıcı yoksa gerekçeli kendi onayı kaydedilir."
      />
      <div className="mt-4 w-56">
        <SelectField
          label="Durum"
          value={status}
          onChange={setStatus}
          placeholder="Tüm durumlar"
          options={Object.entries(STATUS).map(([v, [l]]) => ({ value: v, label: l }))}
        />
      </div>
      {list.error && <Alert>{list.error}</Alert>}
      {list.data?.items.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          Değişiklik seti yok. Mağaza sayfasındaki "Yayına al" ya da Kurallar sayfasındaki "Yeni
          kural" bir set açar.
        </p>
      )}
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
        {list.data?.items.map((c) => (
          <li key={c.id}>
            <a
              href={`#/changesets/${c.id}`}
              className="flex flex-wrap items-center gap-2 p-3 text-sm hover:bg-surface-2"
            >
              <Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
              <span className="font-medium">{c.title}</span>
              {c.self_approved && <Badge tone="warn">kendi onayı</Badge>}
              {c.rolled_back_by_id && <Badge tone="muted">geri alındı</Badge>}
              <span className="ml-auto text-xs text-muted">
                {c.item_count} öğe · {fmtDate(c.published_at ?? c.created_at)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function ChangesetDetail({ me, id }: { me: AdminMe; id: string }) {
  const { data: c, error, reload } = useResource<Changeset>(`/admin/v1/changesets/${id}`);
  const action = useAction();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [when, setWhen] = useState('');
  const isApprover = me.roles.includes('approver');
  const canPrepare = me.roles.includes('platform_admin') || me.roles.includes('editor');
  const own = c?.created_by === me.id;

  async function act(path: string, body?: object, go?: (r: Changeset) => void) {
    const r = await action.run(() =>
      api<Changeset>(`/admin/v1/changesets/${id}/${path}`, { method: 'POST', body: body ?? {} }),
    );
    if (r.ok) {
      if (go) go(r.value);
      else await reload();
    }
  }

  return (
    <>
      <a
        href="#/changesets"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden /> Tüm setler
      </a>
      {error && <Alert>{error}</Alert>}
      {c && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{c.title}</h1>
            <Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
            {c.self_approved && <Badge tone="warn">kendi onayı</Badge>}
          </div>
          {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <div>Açıldı: {fmtDate(c.created_at)}</div>
            {c.approved_at && <div>Onay: {fmtDate(c.approved_at)}</div>}
            {c.scheduled_at && <div>Zaman: {fmtDate(c.scheduled_at)}</div>}
            {c.published_at && <div>Yayın: {fmtDate(c.published_at)}</div>}
            {c.rollback_of_id && (
              <div>
                Geri aldığı set:{' '}
                <a
                  className="text-accent hover:underline"
                  href={`#/changesets/${c.rollback_of_id}`}
                >
                  …{c.rollback_of_id.slice(-6)}
                </a>
              </div>
            )}
            {c.rolled_back_by_id && (
              <div>
                Geri alan set:{' '}
                <a
                  className="text-accent hover:underline"
                  href={`#/changesets/${c.rolled_back_by_id}`}
                >
                  …{c.rolled_back_by_id.slice(-6)}
                </a>
              </div>
            )}
          </dl>
          {c.self_approval_reason && (
            <p className="mt-2 text-xs text-warn">
              Kendi onayı gerekçesi: {c.self_approval_reason}
            </p>
          )}
          {c.last_error && <Alert>Son yayın denemesi başarısız: {c.last_error}</Alert>}

          <section aria-labelledby="items-title" className="mt-6">
            <h2 id="items-title" className="font-semibold">
              Değişiklikler
            </h2>
            <ul className="mt-2 space-y-2">
              {c.items.map((i) => (
                <li key={i.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                  <p>
                    <span className="font-medium">{i.label}</span> · {OP[i.op] ?? i.op}
                    {i.entity_id && (
                      <code className="ml-2 text-xs text-muted">…{i.entity_id.slice(-8)}</code>
                    )}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted">
                        {c.status === 'published' ? 'Önceki durum' : 'Şu anki canlı durum'}
                      </p>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 text-xs">
                        {i.before ? JSON.stringify(i.before, null, 2) : '—'}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs text-muted">İstenen</p>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 text-xs">
                        {Object.keys(i.payload).length
                          ? JSON.stringify(i.payload, null, 2)
                          : OP[i.op]}
                      </pre>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {c.approvals.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-muted">
              {c.approvals.map((a) => (
                <li key={a.at}>
                  {fmtDate(a.at)} · {a.decision === 'approve' ? 'onay' : 'ret'}
                  {a.approver_id === me.id ? ' (siz)' : ''}
                  {a.comment ? ` — ${a.comment}` : ''}
                </li>
              ))}
            </ul>
          )}

          <section
            aria-label="İşlemler"
            className="mt-6 space-y-3 rounded-lg border border-line bg-surface p-4"
          >
            {action.error && <Alert>{action.error}</Alert>}
            {(c.status === 'draft' || c.status === 'rejected') && canPrepare && (
              <Button busy={action.busy} onClick={() => void act('submit')}>
                İncelemeye gönder
              </Button>
            )}
            {c.status === 'in_review' && isApprover && (
              <div className="space-y-2">
                {own && (
                  <label className="block text-sm">
                    <span className="font-medium">Kendi onayı gerekçesi</span>
                    <span className="block text-xs text-muted">
                      Başka aktif onaylayıcı yoksa zorunlu (en az 10 karakter); kayda geçer.
                    </span>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-md border border-line bg-surface p-2"
                    />
                  </label>
                )}
                <label className="block text-sm">
                  <span className="font-medium">Not</span>
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    busy={action.busy}
                    onClick={() =>
                      void act('approve', {
                        comment: comment || undefined,
                        self_approval_reason: own ? reason : undefined,
                      })
                    }
                  >
                    Onayla
                  </Button>
                  <Button
                    variant="ghost"
                    busy={action.busy}
                    disabled={comment.trim().length < 3}
                    onClick={() => void act('reject', { comment })}
                  >
                    Reddet (not gerekli)
                  </Button>
                </div>
              </div>
            )}
            {c.status === 'approved' && (isApprover || me.roles.includes('platform_admin')) && (
              <div className="flex flex-wrap items-end gap-2">
                <Button busy={action.busy} onClick={() => void act('publish')}>
                  Şimdi yayınla
                </Button>
                <label className="text-sm">
                  <span className="block text-xs text-muted">ya da zamanla</span>
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="h-10 rounded-md border border-line bg-surface px-2"
                  />
                </label>
                <Button
                  variant="ghost"
                  disabled={!when}
                  busy={action.busy}
                  onClick={() =>
                    void act('publish', { scheduled_at: new Date(when).toISOString() })
                  }
                >
                  Zamanla
                </Button>
              </div>
            )}
            {c.status === 'published' && !c.rolled_back_by_id && canPrepare && (
              <Button
                variant="ghost"
                busy={action.busy}
                onClick={() =>
                  void act(
                    'rollback',
                    undefined,
                    (r) => (window.location.hash = `#/changesets/${r.id}`),
                  )
                }
              >
                <Undo2 className="size-4" aria-hidden />
                Geri almak için yeni set aç
              </Button>
            )}
            {['draft', 'in_review', 'approved', 'scheduled', 'rejected'].includes(c.status) && (
              <Button variant="ghost" busy={action.busy} onClick={() => void act('cancel')}>
                Seti iptal et
              </Button>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Tek öğeli set açıp ayrıntısına gider (mağaza yayını, kural). */
export async function openChangeset(
  title: string,
  items: { entity_type: string; entity_id?: string | null; op: string; payload?: object }[],
) {
  const c = await api<{ id: string }>('/admin/v1/changesets', {
    method: 'POST',
    body: { title, items: items.map((i) => ({ payload: {}, ...i })) },
  });
  window.location.hash = `#/changesets/${c.id}`;
}
