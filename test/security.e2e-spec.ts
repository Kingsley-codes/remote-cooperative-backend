import {
  Body,
  Controller,
  Get,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsInt, Max, Min } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Public } from '../src/common/security/public.decorator.js';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';

class AmountDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  amount!: number;
}

// These routes exist only in the test application.
@Controller('_security-test')
class SecurityTestController {
  @Get('private')
  privateRoute() {
    return { secret: true };
  }

  @Public()
  @Post('input')
  input(@Body() body: AmountDto) {
    return body;
  }

  @Public()
  @Post('raw')
  raw(@Req() req: RawBodyRequest<Request>) {
    return { raw: req.rawBody?.toString('utf8') };
  }

  @Public()
  @Get('error')
  error() {
    throw new Error('database-password=do-not-expose');
  }
}

describe('HTTP security', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const config = validateEnvironment({
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://localhost:3001',
      HTTP_BODY_LIMIT_KB: '1',
      RATE_LIMIT_MAX: '3',
      RATE_LIMIT_BURST_MAX: '100',
    });
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SecurityTestController],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
    });
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sets security headers and generates its own request ID', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('X-Request-Id', 'untrusted');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[\da-f-]{36}$/);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('allows configured CORS preflights without allowing credentialed cookies', async () => {
    const res = await request(app.getHttpServer())
      .options('/')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3001',
    );
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it.each([
    'https://evil.example',
    'http://localhost:3001.evil.example',
    'null',
  ])('rejects an unlisted Origin: %s', async (origin) => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('Origin', origin);
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('denies protected routes even with an unverified token', async () => {
    await request(app.getHttpServer())
      .get('/_security-test/private')
      .expect(401);
    await request(app.getHttpServer())
      .get('/_security-test/private')
      .set('Authorization', 'Bearer forged-token')
      .expect(401);
  });

  it('enforces rate limits even when forwarded IP headers are forged', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .get('/')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`)
        .expect(200);
    }
    const res = await request(app.getHttpServer())
      .get('/')
      .set('X-Forwarded-For', '203.0.113.99');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('accepts a validated DTO', async () => {
    await request(app.getHttpServer())
      .post('/_security-test/input')
      .send({ amount: 50 })
      .expect(201)
      .expect({ amount: 50 });
  });

  it.each([
    { amount: 50, isAdmin: true },
    { amount: { $gt: 0 } },
    { amount: '50' },
    { amount: -1 },
  ])('rejects extra fields and invalid financial input: %j', async (body) => {
    await request(app.getHttpServer())
      .post('/_security-test/input')
      .send(body)
      .expect(400);
  });

  it('rejects oversized JSON before reaching the controller', async () => {
    await request(app.getHttpServer())
      .post('/_security-test/input')
      .send({ data: 'x'.repeat(2048) })
      .expect(413);
  });

  it('rejects malformed JSON without reflecting the submitted content', async () => {
    const res = await request(app.getHttpServer())
      .post('/_security-test/input')
      .set('Content-Type', 'application/json')
      .send('{"secret":"sensitive",');
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('sensitive');
  });

  it('rejects form submissions', async () => {
    await request(app.getHttpServer())
      .post('/_security-test/input')
      .type('form')
      .send({ amount: 50 })
      .expect(415);
  });

  it('preserves exact raw JSON bytes for future webhook signature verification', async () => {
    const raw = '{ "amount": 50 }';
    const res = await request(app.getHttpServer())
      .post('/_security-test/raw')
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ raw });
  });

  it('does not expose internal exception details', async () => {
    const res = await request(app.getHttpServer()).get('/_security-test/error');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal Server Error');
    expect(res.text).not.toContain('database-password');
    expect(res.body.stack).toBeUndefined();
  });
});
