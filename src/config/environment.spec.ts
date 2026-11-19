import { validateEnvironment } from './environment.js';

describe('environment validation', () => {
  it.each([
    { PORT: '0' },
    { RATE_LIMIT_MAX: '-1' },
    { HTTP_BODY_LIMIT_KB: 'unlimited' },
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://*.example.com' },
    { CORS_ORIGINS: 'https://example.com/path' },
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', CORS_ORIGINS: 'http://example.com' },
    {
      REMOTE_AGRIC_API_URL: 'https://identity.example.com/path',
      REMOTE_AGRIC_ORIGIN: 'https://remote.example.com',
    },
    { REMOTE_AGRIC_API_URL: 'https://identity.example.com' },
    { GOOGLE_CLIENT_ID: 'partial-configuration' },
    { MONGO_URI: 'https://example.com' },
    { MONGO_URI: 'mongodb://localhost:27017' },
    { MONGO_URI: 'mongodb://localhost:27017/' },
    { MONGO_URI: 'mongodb://localhost:27017/../remote-agric' },
    { ADMIN_SESSION_TTL_HOURS: '0' },
    { ADMIN_SESSION_TTL_HOURS: '25' },
    { ADMIN_TOKEN_SECRET: 'too-short' },
    {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: 'https://evil.example.com/api/auth/google/callback',
    },
  ])('fails startup for unsafe or invalid settings: %j', (input) => {
    expect(() => validateEnvironment(input)).toThrow();
  });

  it('accepts exact HTTPS production origins', () => {
    const env = validateEnvironment({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://coop.example.com',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://coop.example.com']);
  });

  it.each([
    'mongodb://127.0.0.1:27017/remote_cooperative',
    'mongodb+srv://user:password@cluster.example.com/remote_cooperative?retryWrites=true&w=majority',
    'mongodb://host1:27017,host2:27017/remote_cooperative?replicaSet=rs0',
  ])('selects the database from MONGO_URI: %s', (uri) => {
    expect(validateEnvironment({ MONGO_URI: uri }).MONGO_URI).toBe(uri);
  });
});
