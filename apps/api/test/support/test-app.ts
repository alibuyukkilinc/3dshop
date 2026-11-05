import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { loadEnv, resetEnvCache } from '../../src/infra/config/env.js';
import { configureHttp } from '../../src/infra/http/configure.js';
import type { TestDatabase } from './test-database.js';

export const ORIGIN = 'http://localhost:5174';

/** Geçici veritabanına bağlı, gerçek HTTP yapılandırmasıyla bir API örneği açar. */
export async function createTestApp(db: TestDatabase): Promise<INestApplication> {
  process.env.DATABASE_URL = db.appUrl;
  process.env.APP_ORIGINS = ORIGIN;
  process.env.SECRETS_KEY ??= Buffer.alloc(32, 7).toString('base64');
  resetEnvCache();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
  configureHttp(app, loadEnv());
  await app.init();
  return app;
}

/** Çerezi taşıyan, Origin başlığını ekleyen küçük istemci. */
export function client(app: INestApplication) {
  const agent = request.agent(app.getHttpServer());
  return {
    get: (url: string) => agent.get(`/api${url}`),
    post: (url: string, body?: object) => agent.post(`/api${url}`).set('Origin', ORIGIN).send(body ?? {}),
    raw: agent,
  };
}
