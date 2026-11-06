import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadEnv, resetEnvCache } from '../src/infra/config/env.js';
import { PrismaService } from '../src/infra/db/prisma.service.js';
import { configureHttp } from '../src/infra/http/configure.js';
import { GUIDE_LLM, type GuideLlm, type GuideMessage, type GuideRequest } from '../src/modules/discovery/public/index.js';
import { SOURCE_CLIENT_FACTORY, SourceSitesService, SourceSyncService } from '../src/modules/integration/public/index.js';
import { VisibilityService } from '../src/modules/rules/public/index.js';
import { ORIGIN } from './support/test-app.js';
import { type TestDatabase, createTestDatabase, hasDatabase } from './support/test-database.js';

const products = ['export-page-1.json', 'export-page-2.json'].flatMap(
  (f) => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/eticaret', f), 'utf8')).data.items as { product_id: number }[],
);
const source = {
  async exportPage(q: { cursor?: number; limit: number }) {
    const rows = products.filter((p) => p.product_id > (q.cursor ?? 0));
    const page = rows.slice(0, q.limit);
    return { items: page, nextCursor: page.at(-1)?.product_id ?? 0, hasMore: rows.length > q.limit };
  },
};

/** Sırayla önceden yazılmış yanıtları döndüren sahte model; gelen istekleri kaydeder. */
class ScriptedLlm implements GuideLlm {
  script: GuideMessage[] = [];
  requests: GuideRequest[] = [];
  async create(params: GuideRequest): Promise<GuideMessage> {
    // İstek sonradan değişse de o anki hali saklansın
    this.requests.push(structuredClone(params));
    const next = this.script.shift();
    if (!next) throw new Error('senaryo bitti');
    return next;
  }
}
const msg = (stop: string, content: unknown[]): GuideMessage =>
  ({ id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, content, usage: {} }) as unknown as GuideMessage;
const toolUse = (name: string, input: object, id = `tu_${name}`) => ({ type: 'tool_use', id, name, input });
const final = (o: object) => msg('end_turn', [{ type: 'text', text: JSON.stringify(o) }]);

describe.skipIf(!hasDatabase)('AI rehber (F5.2, K52)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  const llm = new ScriptedLlm();
  const ask = (body: object) => request(app.getHttpServer()).post('/api/v1/guide').set('Origin', ORIGIN).send(body);
  let p101 = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.appUrl;
    process.env.APP_ORIGINS = ORIGIN;
    process.env.SECRETS_KEY ??= Buffer.alloc(32, 7).toString('base64');
    process.env.AI_GUIDE_PER_MINUTE = '100';
    resetEnvCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SOURCE_CLIENT_FACTORY)
      .useValue(() => source)
      .overrideProvider(GUIDE_LLM)
      .useValue(llm)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
    configureHttp(app as NestExpressApplication, loadEnv());
    await app.init();
    prisma = app.get(PrismaService);
    const sites = app.get(SourceSitesService);
    await sites.register({ code: 'esensolarmarket', baseUrl: 'https://esensolarmarket.com', companyDisplayName: 'Esen Solar', storeName: 'Esen Solar Market' });
    await sites.setToken('esensolarmarket', 'test-token-0123456789abcdef');
    await app.get(SourceSyncService).run('esensolarmarket', 'full');
    await prisma.store.updateMany({ data: { status: 'active' } });
    await app.get(VisibilityService).recompute({ all: true });
    p101 = (await prisma.catalogProduct.findFirstOrThrow({ where: { externalId: '101' } })).id;
  });
  beforeEach(() => {
    llm.script = [];
    llm.requests = [];
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('araçla bulunan ürün: kart sunucudaki fiyattan; istek strict araç, şema ve ret yedeği taşır', async () => {
    llm.script = [
      msg('tool_use', [{ type: 'thinking', thinking: '', signature: 'sig' }, toolUse('search_products', { query: 'ürün 101', in_stock_only: false, max_price_try: null })]),
      final({ answer: 'Esen Solar Market’te uygun bir ürün buldum.', product_ids: [p101], store_slugs: ['esensolarmarket'], navigate_store: null }),
    ];
    const r = await ask({ message: 'Ürün 101 var mı?' });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('ai');
    expect(r.body.products[0]).toMatchObject({ id: p101, name: 'Ürün 101', store: { slug: 'esensolarmarket' } });
    expect(r.body.products[0].price.final_minor).toBe(1470890);
    expect(r.body.stores).toEqual([{ slug: 'esensolarmarket', name: 'Esen Solar Market' }]);

    const req0 = llm.requests[0]!;
    expect(req0.model).toBe('claude-opus-5-5');
    expect(req0.tools?.every((t) => 'strict' in t && t.strict === true)).toBe(true);
    expect(req0.output_config?.format?.type).toBe('json_schema');
    expect((req0 as { fallbacks?: unknown }).fallbacks).toBe('default');
    expect(req0.betas).toEqual(['server-side-fallback-2026-07-01']);
    // İkinci çağrı: asistan yanıtı (düşünme bloğu dahil, değiştirilmeden) + araç sonucu
    const m = llm.requests[1]!.messages;
    expect(m[1]).toMatchObject({ role: 'assistant' });
    expect((m[1]!.content as { type: string }[])[0]!.type).toBe('thinking');
    const tr = (m[2]!.content as { type: string; content: string }[])[0]!;
    expect(tr.type).toBe('tool_result');
    expect(JSON.parse(tr.content).items[0].id).toBe(p101);

    // Aynı oturumda ikinci soru: geçmiş yalnız büyür (önek aynen korunur)
    llm.script = [final({ answer: 'Başka bir şey bulamadım.', product_ids: [], store_slugs: [], navigate_store: null })];
    const r2 = await ask({ session_id: r.body.session_id, message: 'Başka var mı?' });
    expect(r2.body.mode).toBe('ai');
    const m2 = llm.requests.at(-1)!.messages;
    expect(m2.slice(0, 4)).toEqual([...m, { role: 'assistant', content: [{ type: 'text', text: expect.any(String) }] }]);
    expect((await prisma.aiSession.findUniqueOrThrow({ where: { id: r.body.session_id } })).turns).toBe(2);
  });

  it('uydurma ürün, fiyat yazan metin ya da ret: cevap düşürülür, klasik arama döner', async () => {
    const fake = '01999999-0000-7000-8000-000000000000';
    llm.script = [final({ answer: 'Şunu öneririm.', product_ids: [fake], store_slugs: [], navigate_store: null })];
    let r = await ask({ message: 'ürün 101' });
    expect(r.body).toMatchObject({ mode: 'search', reason: 'unknown_product', answer: null });
    expect(r.body.products.map((p: { id: string }) => p.id)).toContain(p101);

    llm.script = [
      msg('tool_use', [toolUse('get_product', { product_id: p101 })]),
      final({ answer: 'Fiyatı 14.708,90 TL.', product_ids: [p101], store_slugs: [], navigate_store: null }),
    ];
    r = await ask({ message: 'ürün 101 fiyatı' });
    expect(r.body.reason).toBe('price_in_text');

    llm.script = [msg('refusal', [])];
    r = await ask({ message: 'ürün 101' });
    expect(r.body.reason).toBe('refusal');

    llm.script = [];
    r = await ask({ message: 'ürün 101' });
    expect(r.body.reason).toBe('error');
  });

  it('rota: 3D şehir ve mağaza bağlantısı; bilinmeyen araç girdisi hata sonucu olur', async () => {
    llm.script = [
      msg('tool_use', [toolUse('route_to', { store_slug: 'esensolarmarket' }), toolUse('get_product', { product_id: 'yok' }, 'tu_bad')]),
      final({ answer: 'Sizi mağazaya götürüyorum.', product_ids: [], store_slugs: ['esensolarmarket'], navigate_store: 'esensolarmarket' }),
    ];
    const r = await ask({ message: 'Esen Solar mağazasına götür' });
    expect(r.body.navigate).toMatchObject({ store_slug: 'esensolarmarket', store_url: '/magaza/esensolarmarket' });
    const results = llm.requests[1]!.messages[2]!.content as { tool_use_id: string; is_error?: boolean }[];
    expect(results).toHaveLength(2);
    expect(results.find((x) => x.tool_use_id === 'tu_bad')?.is_error).toBe(true);
  });

  it('doğrulama ve saklama: boş/uzun mesaj 400, Origin yoksa 403; 30 günden eski sohbet silinir', async () => {
    expect((await ask({ message: '' })).status).toBe(400);
    expect((await ask({ message: 'x'.repeat(501) })).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/api/v1/guide').send({ message: 'a' })).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/api/v1/guide/status')).body).toEqual({ enabled: true });

    const before = await prisma.aiSession.count();
    await prisma.aiSession.updateMany({ data: { updatedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const { GuideService } = await import('../src/modules/discovery/public/index.js');
    expect(await app.get(GuideService).purgeExpired()).toBe(before);
  });
});
