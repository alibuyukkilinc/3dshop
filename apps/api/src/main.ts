import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadEnv } from './infra/config/env.js';
import { configureHttp } from './infra/http/configure.js';
import { ErrorReporter } from './modules/ops/public/index.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Webhook imzası ham gövde üzerinden doğrulanır (F1.4)
    rawBody: true,
  });
  configureHttp(app, env);
  app.enableShutdownHooks();
  const reporter = app.get(ErrorReporter);
  process.on('unhandledRejection', (reason) => void reporter.report(reason, 'api', { kind: 'unhandledRejection' }));
  await app.listen(env.API_PORT);
  console.log(`API hazır: http://localhost:${env.API_PORT}/api/healthz`);
}

void bootstrap();
