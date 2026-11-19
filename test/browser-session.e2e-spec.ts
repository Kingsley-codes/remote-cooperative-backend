import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { RemoteAgricService } from '../src/auth/remote-agric.service.js';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { UnauthorizedException } from '@nestjs/common';

describe('Browser sessions and OAuth', () => {
  let app: NestExpressApplication;
  const token = 'signed.identity.token';
  const user = { id: 'member', membershipStatus: 'pending' };
  const remote = { identity: vi.fn(), login: vi.fn(), request: vi.fn() };
  const auth = { googleStart: vi.fn(), google: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const config = validateEnvironment({
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://localhost:3001',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      .overrideProvider(RemoteAgricService)
      .useValue(remote)
      .overrideProvider(AuthService)
      .useValue(auth)
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

  it('rejects cookie mutations without a trusted Origin before checking identity', async () => {
    for (const origin of [undefined, 'https://evil.example']) {
      const call = request(app.getHttpServer())
        .post('/auth/accept-terms')
        .set('Cookie', `cooperative_session=${token}`);
      if (origin) call.set('Origin', origin);
      await call.send({ acceptTerms: true, termsVersion: '1.0' }).expect(403);
    }
    expect(remote.identity).not.toHaveBeenCalled();
  });

  it('clears an expired session during logout', async () => {
    remote.identity.mockRejectedValue(new UnauthorizedException());
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `cooperative_session=${token}`)
      .set('Origin', 'http://localhost:3001')
      .send({})
      .expect(200, { loggedOut: true });
    expect(response.headers['set-cookie'][0]).toContain(
      'cooperative_session=;',
    );
    expect(response.headers['set-cookie'][0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
  });

  it.each(['active', 'pending'])(
    'completes Google OAuth and routes %s members',
    async (membershipStatus) => {
      auth.googleStart.mockImplementation((body) => ({
        url: `https://accounts.google.com/o/oauth2/v2/auth?state=${body.state}`,
      }));
      auth.google.mockResolvedValue({
        sessionToken: token,
        user: { ...user, membershipStatus },
      });
      const initial = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(303);
      const cookie = initial.headers['set-cookie'][0].split(';')[0];
      const flow = JSON.parse(
        decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)),
      );
      expect(flow.state).toHaveLength(43);
      expect(flow.nonce).toHaveLength(43);
      expect(auth.googleStart).toHaveBeenCalledWith({
        state: flow.state,
        nonce: flow.nonce,
        codeChallenge: createHash('sha256')
          .update(flow.codeVerifier)
          .digest('base64url'),
      });
      const callback = await request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({ state: flow.state, code: 'google-code' })
        .set('Cookie', cookie)
        .expect(303);
      expect(auth.google).toHaveBeenCalledWith({
        code: 'google-code',
        codeVerifier: flow.codeVerifier,
        nonce: flow.nonce,
      });
      expect(callback.headers.location).toBe(
        `http://localhost:3001/${membershipStatus === 'active' ? 'dashboard' : 'onboarding'}`,
      );
      expect(callback.headers['set-cookie'].join(';')).toContain(
        `cooperative_session=${token}`,
      );
      expect(callback.headers.location).not.toContain(token);
    },
  );

  it.each(['missing', 'mismatched', 'expired', 'provider-error'])(
    'rejects %s OAuth callbacks',
    async (failure) => {
      const flow = {
        state: 's'.repeat(43),
        nonce: 'n'.repeat(43),
        codeVerifier: 'v'.repeat(43),
        expires: Date.now() + 600000,
      };
      if (failure === 'expired') flow.expires = Date.now() - 1000;
      const call = request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({
          state: failure === 'mismatched' ? 'wrong' : flow.state,
          code: 'code',
          ...(failure === 'provider-error' ? { error: 'access_denied' } : {}),
        });
      if (failure !== 'missing')
        call.set(
          'Cookie',
          `cooperative_oauth=${encodeURIComponent(JSON.stringify(flow))}`,
        );
      const response = await call.expect(303);
      expect(response.headers.location).toBe(
        'http://localhost:3001/login?error=google_failed',
      );
      expect(response.headers['set-cookie'].join(';')).toContain(
        'cooperative_oauth=;',
      );
      expect(auth.google).not.toHaveBeenCalled();
    },
  );
});
