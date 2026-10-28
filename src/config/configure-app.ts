import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { HttpExceptionFilter } from '../common/security/http-exception.filter.js';
import type { Environment } from './environment.js';

// Shared by production bootstrap and HTTP security tests.
// Create the Nest application with { bodyParser: false, rawBody: true }.
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  const production = config.get('NODE_ENV', { infer: true }) === 'production';
  const origins = config.get('CORS_ORIGINS', { infer: true });
  const logger = new Logger('HTTP');

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('query parser', 'simple');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      strictTransportSecurity: production ? { maxAge: 31536000 } : false,
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = Date.now();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () =>
      logger.log({
        event: 'http_request',
        requestId,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
      }),
    );
    if (
      req.headers.origin !== undefined &&
      !origins.includes(req.headers.origin)
    ) {
      res
        .status(403)
        .json({ statusCode: 403, message: 'Forbidden', requestId });
      return;
    }
    next();
  });

  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const hasBody =
      req.headers['transfer-encoding'] !== undefined ||
      (req.headers['content-length'] !== undefined &&
        req.headers['content-length'] !== '0');
    if (hasBody && !req.is('application/json')) {
      res.status(415).json({
        statusCode: 415,
        message: 'Unsupported Media Type',
        requestId: res.getHeader('X-Request-Id'),
      });
      return;
    }
    next();
  });

  app.useBodyParser('json', {
    limit: config.get('HTTP_BODY_LIMIT_KB', { infer: true }) * 1024,
    strict: true,
    inflate: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      disableErrorMessages: production,
      stopAtFirstError: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  const server = app.getHttpServer();
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  app.enableShutdownHooks();
}
