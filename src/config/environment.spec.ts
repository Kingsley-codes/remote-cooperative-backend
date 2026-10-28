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
});
