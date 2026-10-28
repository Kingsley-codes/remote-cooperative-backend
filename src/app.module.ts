import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthenticationGuard } from './common/security/authentication.guard.js';
import { validateEnvironment } from './config/environment.js';
import type { Environment } from './config/environment.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        throttlers: [
          {
            name: 'burst',
            ttl: 1000,
            limit: config.get('RATE_LIMIT_BURST_MAX', { infer: true }),
          },
          {
            name: 'default',
            ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
            limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          },
        ],
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
  ],
})
export class AppModule {}
