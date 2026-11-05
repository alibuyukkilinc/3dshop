import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadEnv } from './infra/config/env.js';
import { configureHttp } from './infra/http/configure.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttp(app, env);
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  console.log(`API hazır: http://localhost:${env.API_PORT}/api/healthz`);
}

void bootstrap();
