'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ProductCard } from '../../components/product-card';
import type { Price } from '../../lib/api';
import { track } from '../../lib/analytics/client';

interface GuideProduct {
  id: string;
  name: string;
  price: Price | null;
  in_stock: boolean;
  image: string | null;
  store: { slug: string; name: string } | null;
}
interface GuideReply {
  session_id: string | null;
  mode: 'ai' | 'search';
  reason?: string;
  answer: string | null;
  products: GuideProduct[];
  stores: { slug: string; name: string }[];
  navigate: { store_slug: string; city_url: string | null; store_url: string } | null;
}
type Turn = { role: 'user'; text: string } | { role: 'guide'; reply: GuideReply } | { role: 'error'; text: string };

const EXAMPLES = ['Güneş paneli için 12V akü arıyorum', 'Hangi mağazalarda inverter var?', 'Stokta olan en uygun şarj kontrol cihazı'];

/** Rehber sohbeti (F5.2, K52). Ürün kartları sunucudaki güncel fiyatla; "Sitede satın al" ai kanalıyla. */
export function GuideClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const session = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), [turns]);

  async function send(message: string) {
    const m = message.trim();
    if (!m || busy) return;
    setTurns((t) => [...t, { role: 'user', text: m }]);
    setText('');
    setBusy(true);
    try {
      const res = await fetch('/api/v1/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.current, message: m }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const reply = (await res.json()) as GuideReply;
      if (reply.session_id) session.current = reply.session_id;
      track('ai_question', { answered: reply.mode === 'ai' });
      setTurns((t) => [...t, { role: 'guide', reply }]);
    } catch {
      setTurns((t) => [...t, { role: 'error', text: 'Şu an cevap veremedim. Biraz sonra tekrar deneyin ya da aramayı kullanın.' }]);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };

  return (
    <div className="mt-6">
      {turns.length === 0 && (
        <div>
          <p className="text-sm text-muted">Örnek sorular:</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              <li key={q}>
                <button type="button" onClick={() => void send(q)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-accent">
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol aria-live="polite" className="space-y-6">
        {turns.map((t, i) => (
          <li key={i}>
            {t.role === 'user' && (
              <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm text-accent-ink">
                <span className="sr-only">Siz: </span>
                {t.text}
              </p>
            )}
            {t.role === 'error' && <p className="text-sm text-warn">{t.text}</p>}
            {t.role === 'guide' && <Reply reply={t.reply} />}
          </li>
        ))}
        {busy && (
          <li className="text-sm text-muted" role="status">
            Rehber arıyor…
          </li>
        )}
      </ol>
      <div ref={endRef} />

      <form onSubmit={submit} className="sticky bottom-0 mt-6 flex gap-2 border-t border-line bg-bg py-3">
        <label htmlFor="rehber-soru" className="sr-only">
          Rehbere sorun
        </label>
        <input
          id="rehber-soru"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          autoComplete="off"
          placeholder="Ne arıyorsunuz?"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="h-11 rounded-md bg-accent px-5 text-sm font-medium text-accent-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Sor
        </button>
      </form>
    </div>
  );
}

function Reply({ reply }: { reply: GuideReply }) {
  return (
    <div>
      <p className="text-sm">
        <span className="sr-only">Rehber: </span>
        {reply.mode === 'ai'
          ? reply.answer
          : reply.products.length
            ? 'Bu soruya şu an rehber olarak cevap veremedim; arama sonuçları:'
            : 'Bu soruya şu an cevap veremedim ve aramada sonuç çıkmadı. Daha kısa ya da farklı kelimelerle deneyin.'}
      </p>
      {reply.navigate && (
        <p className="mt-2 flex flex-wrap gap-3 text-sm">
          {reply.navigate.city_url && (
            <Link href={reply.navigate.city_url} className="font-medium text-accent underline">
              3D şehirde mağazaya git
            </Link>
          )}
          <Link href={reply.navigate.store_url} className="underline">
            Mağaza sayfası
          </Link>
        </p>
      )}
      {reply.stores.length > 0 && !reply.navigate && (
        <p className="mt-2 flex flex-wrap gap-3 text-sm">
          {reply.stores.map((s) => (
            <Link key={s.slug} href={`/magaza/${s.slug}`} className="underline">
              {s.name}
            </Link>
          ))}
        </p>
      )}
      {reply.products.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {reply.products.map((p) => (
            <ProductCard key={p.id} product={{ ...p, synced_at: '' }} storeName={p.store?.name} />
          ))}
        </ul>
      )}
    </div>
  );
}
