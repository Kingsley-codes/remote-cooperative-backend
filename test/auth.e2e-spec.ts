import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { UserStore } from '../src/users/user.store.js';
import { ObjectId } from 'mongodb';

describe('Authentication integration', () => {
  let app: NestExpressApplication;
  const upstream = vi.fn<typeof fetch>();
  const localUser = { _id: new ObjectId(), membershipStatus: 'pending' };
  const users = {
    syncProfile: vi.fn(),
    findByRemoteId: vi.fn(),
    acceptTerms: vi.fn(),
  };
  const user = {
    _id: '0123456789abcdef01234567',
    email: 'farmer@example.com',
    firstName: 'Remote',
    lastName: 'Farmer',
    farmerID: 'RAU-123',
    status: 'active',
    isVerified: true,
    hasActiveInvestment: false,
    password: 'must-not-leak',
  };
  const token = 'signed.identity.token';
  const signup = {
    email: 'farmer@example.com',
    firstName: 'Remote',
    lastName: 'Farmer',
    phone: '+2348012345678',
    password: 'StrongPass1!',
    confirmPassword: 'StrongPass1!',
    acceptTerms: true,
  };
  const reply = (data: unknown, status = 200, session = false) =>
    new Response(JSON.stringify(data), {
      status,
      headers: session
        ? { 'Set-Cookie': `user_token=${token}; HttpOnly; Path=/` }
        : {},
    });

  beforeEach(async () => {
    vi.stubGlobal('fetch', upstream);
    upstream.mockReset();
    users.syncProfile.mockReset().mockResolvedValue(localUser);
    users.findByRemoteId.mockReset().mockResolvedValue(localUser);
    users.acceptTerms.mockReset();
    const config = validateEnvironment({
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://localhost:3001',
      REMOTE_AGRIC_API_URL: 'https://identity.example.com',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UserStore)
      .useValue(users)
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
    vi.unstubAllGlobals();
  });

  it('allows new farmers to register without an existing account or investment', async () => {
    upstream.mockResolvedValue(reply({ requiresVerification: true }, 202));
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signup)
      .expect(202, { requiresVerification: true });
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe('https://identity.example.com/api/auth/register');
    expect(init!.headers).not.toHaveProperty('Authorization');
    expect(init!.headers).not.toHaveProperty('Origin');
    expect(JSON.parse(init!.body as string)).toEqual(
      expect.objectContaining({ phone: signup.phone, email: signup.email }),
    );
    expect(JSON.parse(init!.body as string)).not.toHaveProperty('acceptTerms');
  });
  it('requires valid data and consent before forwarding signup', async () => {
    for (const body of [
      { ...signup, acceptTerms: false },
      { ...signup, phone: '08012345678' },
      { ...signup, email: { $ne: '' } },
      { ...signup, role: 'admin' },
    ]) {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send(body)
        .expect(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('completes email verification using Remote Agric OTP', async () => {
    upstream.mockResolvedValue(reply({ status: 'success' }, 201));
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: signup.email, otp: '123456' })
      .expect(200, { verified: true });
    expect(upstream.mock.calls[0]![0]).toBe(
      'https://identity.example.com/api/auth/register/verify-otp',
    );
  });
  it('returns a session and a minimal profile after password login', async () => {
    upstream.mockResolvedValue(reply({ data: { user } }, 200, true));
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ' FARMER@example.com ', password: signup.password })
      .expect(200);
    expect(response.body).not.toHaveProperty('sessionToken');
    expect(response.headers['set-cookie'][0]).toContain(
      `cooperative_session=${token}`,
    );
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.body.user.id).toBe(user._id);
    expect(response.body.user.localUserId).toBe(localUser._id.toHexString());
    expect(response.body.user.membershipStatus).toBe('pending');
    expect(users.syncProfile).toHaveBeenCalledWith(
      user._id,
      expect.objectContaining({ email: user.email }),
    );
    expect(response.body.user).not.toHaveProperty('password');
    expect(JSON.parse(upstream.mock.calls[0]![1]!.body as string).email).toBe(
      'farmer@example.com',
    );
  });
  it('rechecks identity on protected requests without requiring an investment', async () => {
    upstream.mockResolvedValue(reply({ data: { user } }));
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `cooperative_session=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(200);
    expect(response.body.user.id).toBe(user._id);
    expect(upstream.mock.calls[0]![1]!.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${token}` }),
    );
    expect(response.body.user).not.toHaveProperty('password');
  });
  it('creates a local profile for an existing Remote Agric session', async () => {
    users.findByRemoteId.mockResolvedValue(null);
    upstream.mockResolvedValue(reply({ data: { user } }));
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `cooperative_session=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(200);
    expect(response.body.user.localUserId).toBe(localUser._id.toHexString());
    expect(users.syncProfile).toHaveBeenCalledOnce();
  });
  it('rejects inactive or unverified login identities before storing a user', async () => {
    for (const identity of [
      { ...user, status: 'suspended' },
      { ...user, isVerified: false },
    ]) {
      upstream.mockResolvedValueOnce(
        reply({ data: { user: identity } }, 200, true),
      );
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: signup.email, password: signup.password })
        .expect(401);
    }
    expect(users.syncProfile).not.toHaveBeenCalled();
  });
  it('does not return a login session if local persistence fails', async () => {
    const { ServiceUnavailableException } = await import('@nestjs/common');
    users.syncProfile.mockRejectedValue(new ServiceUnavailableException());
    upstream.mockResolvedValue(reply({ data: { user } }, 200, true));
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signup.email, password: signup.password })
      .expect(503);
    expect(response.body).not.toHaveProperty('sessionToken');
  });
  it('rejects forged tokens, suspended users and revoked sessions', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer invalid; injected=1')
      .expect(401);
    expect(upstream).not.toHaveBeenCalled();
    upstream.mockResolvedValueOnce(
      reply({ data: { user: { ...user, status: 'suspended' } } }),
    );
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `cooperative_session=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(401);
    upstream.mockResolvedValueOnce(reply({ message: 'Session revoked' }, 401));
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `cooperative_session=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(401);
  });
  it('fails closed for upstream outages and never echoes internal errors', async () => {
    upstream.mockRejectedValue(new Error('sensitive connection info'));
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signup.email, password: signup.password })
      .expect(503);
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });
  it('revokes the Remote Agric session on logout', async () => {
    upstream
      .mockResolvedValueOnce(reply({ data: { user } }))
      .mockResolvedValueOnce(reply({ status: 'success' }));
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `cooperative_session=${token}`)
      .set('Origin', 'http://localhost:3001')
      .send({})
      .expect(200, { loggedOut: true });
    expect(upstream.mock.calls[1]![1]!.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${token}`,
      }),
    );
    expect(upstream.mock.calls[1]![0]).toBe(
      'https://identity.example.com/api/auth/logout',
    );
    expect(upstream.mock.calls[1]![1]!.headers).not.toHaveProperty('Origin');
  });
  it('fails safely when Google credentials have not been configured', async () => {
    await request(app.getHttpServer())
      .post('/auth/google/start')
      .send({
        state: 's'.repeat(43),
        nonce: 'n'.repeat(43),
        codeChallenge: 'c'.repeat(43),
      })
      .expect(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('requires authentication and explicit acceptance of the current terms', async () => {
    await request(app.getHttpServer())
      .post('/auth/accept-terms')
      .send({ acceptTerms: true, termsVersion: '1.0' })
      .expect(401);
    upstream.mockImplementation(async () => reply({ data: { user } }));
    for (const body of [
      { acceptTerms: false, termsVersion: '1.0' },
      { acceptTerms: true, termsVersion: 'old' },
      { acceptTerms: true },
      { acceptTerms: true, termsVersion: '1.0', userId: 'someone-else' },
    ]) {
      await request(app.getHttpServer())
        .post('/auth/accept-terms')
        .set('Cookie', `cooperative_session=${token}`)
        .set('Origin', 'http://localhost:3001')
        .send(body)
        .expect(400);
    }
    expect(users.acceptTerms).not.toHaveBeenCalled();
  });

  it('activates only the authenticated user through cooperative onboarding', async () => {
    upstream.mockResolvedValue(reply({ data: { user } }));
    const termsAcceptedAt = new Date();
    users.acceptTerms.mockResolvedValue({
      ...localUser,
      membershipStatus: 'active',
      termsAcceptedAt,
      termsVersion: '1.0',
    });
    const response = await request(app.getHttpServer())
      .post('/auth/accept-terms')
      .set('Cookie', `cooperative_session=${token}`)
      .set('Origin', 'http://localhost:3001')
      .send({ acceptTerms: true, termsVersion: '1.0' })
      .expect(200);
    expect(users.acceptTerms).toHaveBeenCalledExactlyOnceWith(user._id);
    expect(response.body).toEqual({
      membershipStatus: 'active',
      termsAcceptedAt: termsAcceptedAt.toISOString(),
      termsVersion: '1.0',
    });
  });
});
