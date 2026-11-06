import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { uuidv7 } from '@dtd/contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import { loadEnv } from '../../../infra/config/env.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { RateLimiter } from '../../../infra/http/rate-limit.js';
import { ANSWER_JSON_SCHEMA, GUIDE_LIMITS, GUIDE_SYSTEM_PROMPT, GUIDE_TOOLS, checkAnswer } from '../domain/guide.js';
import { GUIDE_LLM, type GuideLlm, type GuideRequest, supportsServerFallback } from './guide-llm.js';
import { GuideTools, type ToolTrace } from './guide-tools.js';
import { StorefrontService } from './storefront.service.js';

type Param = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** Klasik aramaya düşme nedeni (K51: hata/gecikmede rehber yerine arama) */
export type FallbackReason =
  | 'disabled'
  | 'rate_limited'
  | 'daily_limit'
  | 'error'
  | 'refusal'
  | 'incomplete'
  | 'unparseable'
  | 'unknown_product'
  | 'unknown_store'
  | 'price_in_text';

const CALL_TIMEOUT_MS = 25_000;

/**
 * AI rehber (F5.2, K52). Claude araç kullanımıyla ai kanalındaki veriyi sorgular; son cevap JSON şemasıyla
 * gelir ve sunucuda doğrulanır. Anahtar yoksa, sınır aşılırsa, model reddederse ya da cevap doğrulanamazsa
 * klasik aramaya düşülür. Sohbet geçmişi yalnız eklenerek tutulur (önbellek ve düşünme blokları korunur).
 */
@Injectable()
export class GuideService {
  private readonly logger = new Logger('guide');
  private readonly daily: RateLimiter;
  private readonly perVisitor: RateLimiter;
  private readonly perVisitorDay = new RateLimiter(60, 86_400_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storefront: StorefrontService,
    private readonly tools: GuideTools,
    @Optional() @Inject(GUIDE_LLM) private readonly llm: GuideLlm | null,
  ) {
    this.daily = new RateLimiter(loadEnv().AI_GUIDE_DAILY_MAX, 86_400_000);
    this.perVisitor = new RateLimiter(loadEnv().AI_GUIDE_PER_MINUTE, 60_000);
  }

  get enabled(): boolean {
    return Boolean(this.llm) && loadEnv().AI_GUIDE_DAILY_MAX > 0;
  }

  async ask(input: { sessionId: string | null; message: string; visitorKey: string }) {
    const message = input.message.trim().slice(0, GUIDE_LIMITS.messageMaxChars);
    if (!this.llm || !this.enabled) return this.fallback(input.sessionId, message, 'disabled');
    if (!this.perVisitor.take(input.visitorKey) || !this.perVisitorDay.take(input.visitorKey)) return this.fallback(input.sessionId, message, 'rate_limited');
    if (!this.daily.take('all')) return this.fallback(input.sessionId, message, 'daily_limit');

    const model = loadEnv().AI_GUIDE_MODEL;
    const session = await this.loadSession(input.sessionId);
    const messages: Param[] = [...session.messages, { role: 'user', content: message }];
    const trace: ToolTrace = { products: new Set(session.seen), stores: new Set() };

    let outcome: { ok: true; answer: ReturnType<typeof checkAnswer> & { ok: true } } | { ok: false; reason: FallbackReason };
    try {
      outcome = await this.loop(model, messages, trace);
    } catch (e) {
      // Ağ/zaman aşımı/API hatası: geçmiş kaydedilmez (yarım tur yok), arama döner
      this.logger.warn(`Rehber çağrısı başarısız: ${(e as Error).name} ${(e as Error).message.slice(0, 200)}`);
      return this.fallback(session.id, message, 'error');
    }

    await this.prisma.aiSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        updatedAt: new Date(),
        turns: 1,
        messages: messages as unknown as Prisma.InputJsonValue,
        seenProductIds: [...trace.products],
        model,
      },
      update: {
        updatedAt: new Date(),
        turns: { increment: 1 },
        messages: messages as unknown as Prisma.InputJsonValue,
        seenProductIds: [...trace.products],
        model,
      },
    });

    if (!outcome.ok) {
      this.logger.log(`Rehber cevabı kullanılmadı (${outcome.reason}); klasik aramaya düşüldü`);
      return this.fallback(session.id, message, outcome.reason);
    }
    const a = outcome.answer.answer;
    const [products, stores, nav] = await Promise.all([
      Promise.all(a.product_ids.map((id) => this.storefront.product(id, 'ai'))),
      Promise.all(a.store_slugs.map((slug) => this.storefront.store(slug, 'ai'))),
      a.navigate_store ? this.storefront.store(a.navigate_store, '3d') : null,
    ]);
    return {
      session_id: session.id,
      mode: 'ai' as const,
      answer: a.answer,
      // Kartlar sunucudaki güncel veriden: fiyat ve stok modelden değil aynadan (K52)
      products: products.flatMap((p) =>
        p
          ? [{ id: p.id, name: p.name, price: p.price, in_stock: p.in_stock, image: p.images[0] ?? null, store: { slug: p.store.slug, name: p.store.name } }]
          : [],
      ),
      stores: stores.flatMap((s) => (s ? [{ slug: s.slug, name: s.name }] : [])),
      navigate: a.navigate_store
        ? { store_slug: a.navigate_store, city_url: nav ? `/sehir?magaza=${a.navigate_store}` : null, store_url: `/magaza/${a.navigate_store}` }
        : null,
    };
  }

  private async loop(model: string, messages: Param[], trace: ToolTrace) {
    const visibleStores = new Set((await this.storefront.stores('ai')).map((s) => s.slug));
    for (let call = 0; call < GUIDE_LIMITS.callsPerQuestion; call++) {
      const res = await this.llm!.create(this.request(model, messages), { timeoutMs: CALL_TIMEOUT_MS });
      // Yanıt olduğu gibi eklenir (düşünme ve yedek blokları dahil): geçmiş yalnız büyür
      messages.push({ role: 'assistant', content: res.content } as Param);
      if (res.stop_reason === 'pause_turn') continue;
      if (res.stop_reason === 'tool_use') {
        const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        const results: ToolResult[] = await Promise.all(
          uses.map(async (u) => {
            const r = await this.tools.run(u.name, u.input, trace).catch(() => ({ ok: false, content: 'Araç hatası' }));
            return { type: 'tool_result' as const, tool_use_id: u.id, content: r.content, ...(r.ok ? {} : { is_error: true }) };
          }),
        );
        // Paralel çağrıların tüm sonuçları tek kullanıcı mesajında
        messages.push({ role: 'user', content: results });
        continue;
      }
      if (res.stop_reason === 'refusal') return { ok: false as const, reason: 'refusal' as const };
      if (res.stop_reason !== 'end_turn') return { ok: false as const, reason: 'incomplete' as const };
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const check = checkAnswer(text, trace.products, visibleStores);
      return check.ok ? { ok: true as const, answer: check } : { ok: false as const, reason: check.reason };
    }
    return { ok: false as const, reason: 'incomplete' as const };
  }

  private request(model: string, messages: Param[]): GuideRequest {
    return {
      model,
      max_tokens: 4096,
      // Sabit önek (araçlar + sistem) önbellekte; değişken kısım yalnız mesajlar
      system: [{ type: 'text', text: GUIDE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: GUIDE_TOOLS.map((t) => ({ ...t, input_schema: t.input_schema as Anthropic.Beta.BetaTool['input_schema'], strict: true })),
      messages,
      // Sohbet: düşük çaba yeterli; son cevap şemaya bağlı
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ANSWER_JSON_SCHEMA as unknown as Record<string, unknown> } },
      ...(supportsServerFallback(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };
  }

  private async loadSession(id: string | null): Promise<{ id: string; messages: Param[]; seen: string[] }> {
    if (id) {
      const s = await this.prisma.aiSession.findUnique({ where: { id } });
      const fresh = s && s.updatedAt.getTime() > Date.now() - GUIDE_LIMITS.retentionDays * 86_400_000;
      if (s && fresh && s.turns < GUIDE_LIMITS.turnsPerSession) {
        return { id: s.id, messages: s.messages as unknown as Param[], seen: s.seenProductIds };
      }
    }
    return { id: uuidv7(), messages: [], seen: [] };
  }

  /** Klasik arama sonucu (search kanalı). Rehber kapalı/sınırda/hatada aynı biçim döner. */
  private async fallback(sessionId: string | null, message: string, reason: FallbackReason) {
    const r = message ? await this.storefront.search(message.slice(0, 100), 1, 'search', 8) : null;
    return {
      session_id: sessionId,
      mode: 'search' as const,
      reason,
      answer: null,
      products: (r?.items ?? []).map((p) => ({ id: p.id, name: p.name, price: p.price, in_stock: p.in_stock, image: p.image, store: p.store })),
      stores: [],
      navigate: null,
    };
  }

  /** 30 günden eski sohbetler silinir (K52). Worker saatlik çağırır. */
  async purgeExpired(now = new Date()): Promise<number> {
    const r = await this.prisma.aiSession.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - GUIDE_LIMITS.retentionDays * 86_400_000) } } });
    return r.count;
  }
}
