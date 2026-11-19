import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AdminStore } from '../src/admin/admin.store.js';
import type { AdminAccount } from '../src/admin/admin.model.js';
import { SignJWT } from 'jose';
import { hashPassword } from '../src/admin/password.js';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';

describe('Independent cooperative admin authentication', () => {
  let app: NestExpressApplication;
  let admin: AdminAccount;
  let passwordHash: string;
  const secret = 'test-only-admin-secret-with-at-least-32-bytes';
  const upstream = vi.fn();
  const store = {
    findByEmail: vi.fn(async (email: string) =>
      email === admin.email ? admin : null,
    ),
    findById: vi.fn(async (id: ObjectId) =>
      id.equals(admin._id) ? admin : null,
    ),
  };
  beforeAll(async () => {
    passwordHash = await hashPassword('IndependentAdminPass1!');
  });
  beforeEach(async () => {
    vi.stubGlobal('fetch', upstream);
    upstream.mockReset();
    admin = {
      _id: new ObjectId(),
      email: 'admin@cooperative.example',
      name: 'Cooperative Admin',
      active: true,
      passwordHash,
      createdAt: new Date(),
    };
    const config = validateEnvironment({
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://localhost:3001',
      ADMIN_TOKEN_SECRET: secret,
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AdminStore)
      .useValue(store)
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

  const credentials = {
    email: 'admin@cooperative.example',
    password: 'IndependentAdminPass1!',
  };
  async function login() {
    return (
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send(credentials)
        .expect(200)
    ).headers['set-cookie'][0]
      .split(';')[0]
      .split('=')[1] as string;
  }

  it('authenticates its own admin without contacting Remote Agric', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ ...credentials, email: ' ADMIN@cooperative.example ' })
      .expect(200);
    expect(response.body.admin).toEqual({
      id: admin._id.toHexString(),
      email: admin.email,
      name: admin.name,
      role: 'admin',
    });
    expect(response.body).not.toHaveProperty('sessionToken');
    expect(response.headers['set-cookie'][0]).toMatch(
      /cooperative_admin=admin_[\w-]+\.[\w-]+\.[\w-]+/,
    );
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=28800');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('provides the verified admin identity and clears the browser cookie on logout', async () => {
    const token = await login();
    const profile = await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Cookie', `cooperative_admin=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(200);
    expect(profile.body.admin.email).toBe(admin.email);
    const logout = await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set('Cookie', `cooperative_admin=${token}`)
      .set('Origin', 'http://localhost:3001')
      .send({})
      .expect(200, { loggedOut: true });
    expect(logout.headers['set-cookie'][0]).toContain('cooperative_admin=;');
    expect(logout.headers['set-cookie'][0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    // Stateless tokens remain valid until expiry even after cookie removal.
    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Cookie', `cooperative_admin=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(200);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects wrong passwords, unknown accounts and disabled admins identically', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ ...credentials, password: 'wrong' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ ...credentials, email: 'unknown@example.com' })
      .expect(401);
    admin.active = false;
    const disabled = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send(credentials)
      .expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(wrong.body.message).toBe(disabled.body.message);
  });
  it('rejects missing, forged and Remote Agric user tokens on admin endpoints', async () => {
    const valid = await login();
    const [header, payload, signature] = valid.split('.');
    const tampered = `${header}.${Buffer.from(JSON.stringify({ sub: new ObjectId().toHexString() })).toString('base64url')}.${signature}`;
    for (const token of [
      '',
      'forged',
      'admin_forged',
      'signed.remoteagric.user',
      tampered,
      `${header}.${payload}.forged`,
    ]) {
      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('Authorization', token ? `Bearer ${token}` : '')
        .expect(401);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects an admin token on member endpoints', async () => {
    const token = await login();
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `cooperative_admin=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects expired tokens, invalid claims, wrong signing keys and deleted accounts', async () => {
    for (const options of [
      { expiry: '-1s' },
      { audience: 'member' },
      { issuer: 'remote-agric' },
      { secret: 'another-test-secret-with-at-least-32-bytes' },
      { sub: new ObjectId().toHexString() },
      { sub: 'invalid-id' },
      { omitExpiry: true },
    ]) {
      let jwt = new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(options.sub ?? admin._id.toHexString())
        .setIssuer(options.issuer ?? 'remote-cooperative-backend')
        .setAudience(options.audience ?? 'cooperative-admin')
        .setIssuedAt();
      if (!options.omitExpiry)
        jwt = jwt.setExpirationTime(options.expiry ?? '1h');
      const token = `admin_${await jwt.sign(new TextEncoder().encode(options.secret ?? secret))}`;
      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
  });
  it('rechecks account status on each admin request', async () => {
    const token = await login();
    admin.active = false;
    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Cookie', `cooperative_admin=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(401);
    admin.active = true;
    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Cookie', `cooperative_admin=${token}`)
      .set('Origin', 'http://localhost:3001')
      .expect(200);
  });
  it('rejects injected query objects and extra privilege fields', async () => {
    for (const body of [
      { ...credentials, email: { $ne: '' } },
      { ...credentials, role: 'admin' },
    ]) {
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send(body)
        .expect(400);
    }
  });
  it('limits repeated password guesses', async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ ...credentials, password: 'wrong' })
        .expect(401);
    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send(credentials)
      .expect(429);
  });
});
