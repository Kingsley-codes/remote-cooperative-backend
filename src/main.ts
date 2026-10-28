import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './config/configure-app.js';
import type { Environment } from './config/environment.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    rawBody: true,
  });
  configureApp(app);
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
