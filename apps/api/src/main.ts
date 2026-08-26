import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { loadApiConfig } from './config/api-config.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: config.corsAllowedOrigins });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  const code =
    error instanceof Error && /^P019_[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'P019_API_BOOTSTRAP_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
