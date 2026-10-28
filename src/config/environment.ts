import { isIP } from 'node:net';

export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  CORS_ORIGINS: string[];
  HTTP_BODY_LIMIT_KB: number;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_BURST_MAX: number;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const text = (key: string, fallback = ''): string => {
    const value = input[key] ?? fallback;
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    return value.trim();
  };
  const integer = (key: string, fallback: number, max: number): number => {
    const value = text(key, String(fallback));
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
      throw new Error(`${key} must be an integer between 1 and ${max}`);
    }
    return Number(value);
  };

  const list = (key: string, fallback = '') =>
    text(key, fallback)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

  const nodeEnv = text('NODE_ENV', 'development');

  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const origins = list(
    'CORS_ORIGINS',
    nodeEnv === 'production' ? '' : 'http://localhost:3000',
  );

  if (nodeEnv === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS must be explicitly configured in production');
  }
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hostname.includes('*') ||
      (nodeEnv === 'production' && url.protocol !== 'https:')
    ) {
      throw new Error(
        'CORS_ORIGINS must contain exact origins, using HTTPS in production',
      );
    }
  }

  const host = text('HOST', '127.0.0.1');
  if (!isIP(host)) throw new Error('HOST must be an IP address');

  return {
    NODE_ENV: nodeEnv as Environment['NODE_ENV'],
    HOST: host,
    PORT: integer('PORT', 3000, 65535),
    CORS_ORIGINS: [...new Set(origins)],
    HTTP_BODY_LIMIT_KB: integer('HTTP_BODY_LIMIT_KB', 64, 1024),
    RATE_LIMIT_TTL_MS: integer('RATE_LIMIT_TTL_MS', 60000, 3600000),
    RATE_LIMIT_MAX: integer('RATE_LIMIT_MAX', 100, 10000),
    RATE_LIMIT_BURST_MAX: integer('RATE_LIMIT_BURST_MAX', 10, 1000),
  };
}
