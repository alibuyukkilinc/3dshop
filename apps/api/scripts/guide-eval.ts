/**
 * K10 rehber değerlendirmesi (F5.2): 50 soruyu çalışan API'ye sorar, otomatik puanlar, sonucu JSON'a yazar.
 * Her soru gerçek Claude çağrısıdır (ücretli; ~50-60 soru × birkaç araç turu). Yalnız onayla çalıştırın.
 *
 *   pnpm --filter @dtd/api guide:eval -- --base http://localhost:3100 --origin http://localhost:3101 [--only f01,s02]
 *
 * Puanlama (otomatik, kaba): find → rehber cevabı + en az bir ürün (+ beklenen kelime); store → mağaza ya da
 * rota; none/offtopic → rehber cevabı ve hiç ürün yok; followup → iki tur da rehber cevabı. Uydurma kontrolü
 * sunucuda zaten yapılır: düşen cevaplar "reason" ile sayılır (unknown_product = uydurma girişimi).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Q {
  id: string;
  kind: 'find' | 'store' | 'none' | 'offtopic' | 'followup';
  q: string;
  then?: string;
  expect_any?: string[];
}
interface Reply {
  session_id: string | null;
  mode: 'ai' | 'search';
  reason?: string;
  answer: string | null;
  products: { name: string }[];
  stores: unknown[];
  navigate: unknown;
}

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const base = arg('base', 'http://localhost:3100');
const origin = arg('origin', 'http://localhost:3101');
const only = arg('only', '');

const set = JSON.parse(readFileSync(resolve(import.meta.dirname, 'guide-eval/questions.json'), 'utf8')) as { questions: Q[] };
const questions = set.questions.filter((q) => !only || only.split(',').includes(q.id));

async function ask(message: string, session: string | null): Promise<{ reply: Reply; ms: number }> {
  const t = Date.now();
  const res = await fetch(`${base}/api/v1/guide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ session_id: session, message }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { reply: (await res.json()) as Reply, ms: Date.now() - t };
}

function grade(q: Q, r: Reply, r2?: Reply): { pass: boolean; why: string } {
  if (r.mode !== 'ai') return { pass: false, why: `aramaya düştü: ${r.reason}` };
  const names = r.products.map((p) => p.name.toLocaleLowerCase('tr-TR'));
  switch (q.kind) {
    case 'find': {
      if (names.length === 0) return { pass: false, why: 'ürün önermedi' };
      const kw = q.expect_any ?? [];
      if (kw.length && !names.some((n) => kw.some((k) => n.includes(k)))) return { pass: false, why: `beklenen kelime yok (${kw.join('/')})` };
      return { pass: true, why: `${names.length} ürün` };
    }
    case 'store':
      return r.stores.length || r.navigate ? { pass: true, why: 'mağaza/rota' } : { pass: false, why: 'mağaza vermedi' };
    case 'none':
    case 'offtopic':
      return names.length === 0 ? { pass: true, why: 'ürün önermedi' } : { pass: false, why: `${names.length} ürün önerdi` };
    case 'followup':
      if (!r2 || r2.mode !== 'ai') return { pass: false, why: `ikinci tur aramaya düştü: ${r2?.reason}` };
      return { pass: true, why: 'iki tur' };
  }
}

const rows: { id: string; kind: string; pass: boolean; why: string; ms: number; answer: string | null; answer2?: string | null }[] = [];
for (const q of questions) {
  try {
    const a = await ask(q.q, null);
    const b = q.then ? await ask(q.then, a.reply.session_id) : undefined;
    const g = grade(q, a.reply, b?.reply);
    rows.push({ id: q.id, kind: q.kind, ...g, ms: a.ms + (b?.ms ?? 0), answer: a.reply.answer, answer2: b?.reply.answer });
    console.log(`${g.pass ? 'GEÇTİ' : 'KALDI'}  ${q.id}  ${g.why}  (${a.ms + (b?.ms ?? 0)} ms)`);
  } catch (e) {
    rows.push({ id: q.id, kind: q.kind, pass: false, why: (e as Error).message, ms: 0, answer: null });
    console.log(`HATA   ${q.id}  ${(e as Error).message}`);
  }
}

const passed = rows.filter((r) => r.pass).length;
const ms = rows.map((r) => r.ms).filter(Boolean).sort((a, b) => a - b);
const summary = {
  at: new Date().toISOString(),
  base,
  total: rows.length,
  passed,
  rate: rows.length ? passed / rows.length : 0,
  by_kind: Object.fromEntries(
    [...new Set(rows.map((r) => r.kind))].map((k) => {
      const ks = rows.filter((r) => r.kind === k);
      return [k, `${ks.filter((r) => r.pass).length}/${ks.length}`];
    }),
  ),
  p50_ms: ms[Math.floor(ms.length / 2)] ?? null,
  p95_ms: ms[Math.floor(ms.length * 0.95)] ?? null,
  rows,
};
const out = resolve(process.cwd(), `guide-eval-${summary.at.slice(0, 19).replace(/[:T]/g, '-')}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(`\n${passed}/${rows.length} geçti (%${Math.round(summary.rate * 100)}); p50 ${summary.p50_ms} ms, p95 ${summary.p95_ms} ms`);
console.log(JSON.stringify(summary.by_kind));
console.log(`Sonuç: ${out}`);
