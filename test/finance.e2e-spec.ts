import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { RemoteAgricService } from '../src/auth/remote-agric.service.js';
import { AdminService } from '../src/admin/admin.service.js';
import { FinanceService } from '../src/finance/finance.service.js';
import { PaystackService } from '../src/finance/paystack.service.js';

describe('Financial API authorization and validation', () => {
  let app: NestExpressApplication;
  const user = {
    localUserId: '0123456789abcdef01234567',
    email: 'member@example.com',
    membershipStatus: 'active',
    termsVersion: '1.0',
    currentTermsVersion: '1.0',
  };
  const service = {
    list: vi.fn(async () => ({ items: [], total: 0 })),
    contribute: vi.fn(async () => ({ status: 'pending' })),
    decide: vi.fn(async () => ({})),
    repay: vi.fn(async () => ({})),
  };
  const origin = 'http://localhost:3001';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          validateEnvironment({
            NODE_ENV: 'test',
            CORS_ORIGINS: origin,
            APP_ORIGIN: origin,
            RATE_LIMIT_BURST_MAX: '1000',
            PAYSTACK_SECRET_KEY: 'sk_test_finance',
          }),
        ),
      )
      .overrideProvider(RemoteAgricService)
      .useValue({
        identity: async (token: string) => {
          if (token !== 'member-token') throw new UnauthorizedException();
          return user;
        },
      })
      .overrideProvider(AdminService)
      .useValue({
        identity: async (token: string) => {
          if (token !== 'admin-token') throw new UnauthorizedException();
          return { id: 'admin-id', role: 'admin' };
        },
      })
      .overrideProvider(FinanceService)
      .useValue(service)
      .overrideProvider(PaystackService)
      .useValue(
        new PaystackService(
          new ConfigService({ PAYSTACK_SECRET_KEY: 'sk_test_finance' }),
        ),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
    });
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    '/finance/summary',
    '/finance/contributions',
    '/finance/transactions',
    '/finance/loans',
    '/admin/finance/loans',
  ])('requires authentication on %s', async (path) => {
    await request(app.getHttpServer()).get(path).expect(401);
  });
  it('does not allow a member session to review all member loans', async () => {
    await request(app.getHttpServer())
      .get('/admin/finance/loans')
      .set('Authorization', 'Bearer member-token')
      .expect(401);
    expect(service.list).not.toHaveBeenCalled();
  });
  it('passes the authenticated member scope even when another member is requested', async () => {
    await request(app.getHttpServer())
      .get('/finance/transactions?memberId=another-member')
      .set('Authorization', 'Bearer member-token')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(
      'transactions',
      { memberId: 'another-member' },
      user.localUserId,
    );
  });
  it('rejects a fractional kobo contribution and unexpected financial fields', async () => {
    for (const body of [
      { type: 'long_term', amount: 10000.5 },
      { type: 'short_term', amount: 10000, status: 'successful' },
    ]) {
      await request(app.getHttpServer())
        .post('/finance/contributions')
        .set('Authorization', 'Bearer member-token')
        .set('Idempotency-Key', 'valid-payment-request')
        .send(body)
        .expect(400);
    }
    expect(service.contribute).not.toHaveBeenCalled();
  });
  it('requires an idempotency key and accepts a valid payment in integer kobo', async () => {
    await request(app.getHttpServer())
      .post('/finance/contributions')
      .set('Authorization', 'Bearer member-token')
      .send({ type: 'long_term', amount: 10000 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/finance/contributions')
      .set('Authorization', 'Bearer member-token')
      .set('Idempotency-Key', 'valid-payment-request')
      .send({ type: 'long_term', amount: 10000 })
      .expect(201);
    expect(service.contribute).toHaveBeenCalledWith(
      user,
      { type: 'long_term', amount: 10000 },
      'valid-payment-request',
    );
  });
  it('requires a rejection reason and records the authenticated admin identity', async () => {
    const endpoint = '/admin/finance/loans/0123456789abcdef01234567/decision';
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer admin-token')
      .send({ decision: 'reject', reason: '' })
      .expect(400);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer admin-token')
      .send({ decision: 'reject', reason: 'Insufficient verified collateral' })
      .expect(201);
    expect(service.decide).toHaveBeenCalledWith(
      '0123456789abcdef01234567',
      { decision: 'reject', reason: 'Insufficient verified collateral' },
      'admin-id',
    );
  });
  it('rejects forged public webhook requests without requiring a browser session', async () => {
    await request(app.getHttpServer())
      .post('/finance/paystack/webhook')
      .set('x-paystack-signature', 'a'.repeat(128))
      .send({ event: 'charge.success', data: { reference: 'coop_forged' } })
      .expect(401);
  });
  it('rejects cookie mutations from an untrusted origin', async () => {
    await request(app.getHttpServer())
      .post('/finance/contributions')
      .set('Cookie', 'cooperative_session=member-token')
      .set('Origin', 'https://untrusted.example')
      .send({ type: 'long_term', amount: 10000 })
      .expect(403);
    expect(service.contribute).not.toHaveBeenCalled();
  });
});
