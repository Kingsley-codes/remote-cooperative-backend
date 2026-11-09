export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  CORS_ORIGINS: string[];
  HTTP_BODY_LIMIT_KB: number;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_BURST_MAX: number;
  REMOTE_AGRIC_API_URL: string;
  REMOTE_AGRIC_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  ADMIN_MONGO_URI: string;
  ADMIN_MONGO_DB: string;
  ADMIN_SESSION_TTL_HOURS: number;
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

  const httpUrl = (key: string, fallback = '', originOnly = false) => {
    const value = text(key, fallback);
    if (!value) return '';
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${key} must be an HTTP(S) URL`);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (originOnly && value !== url.origin) ||
      (nodeEnv === 'production' && url.protocol !== 'https:')
    ) {
      throw new Error(
        `${key} must be a trusted HTTP(S) URL, HTTPS in production`,
      );
    }
    return value;
  };
  const remoteApi = httpUrl('REMOTE_AGRIC_API_URL', '', true);
  const remoteOrigin = httpUrl('REMOTE_AGRIC_ORIGIN', '', true);
  const googleRedirect = httpUrl('GOOGLE_REDIRECT_URI');
  const googleId = text('GOOGLE_CLIENT_ID');
  const googleSecret = text('GOOGLE_CLIENT_SECRET');
  if (
    [googleId, googleSecret, googleRedirect].some(Boolean) &&
    ![googleId, googleSecret, googleRedirect].every(Boolean)
  ) {
    throw new Error('Configure all Google OAuth settings together');
  }
  if (
    googleRedirect &&
    (!origins.includes(new URL(googleRedirect).origin) ||
      new URL(googleRedirect).pathname !== '/api/auth/google/callback')
  ) {
    throw new Error(
      'GOOGLE_REDIRECT_URI must use an allowed frontend origin and /api/auth/google/callback',
    );
  }
  if (remoteApi && !remoteOrigin)
    throw new Error(
      'REMOTE_AGRIC_ORIGIN is required with REMOTE_AGRIC_API_URL',
    );

  const adminMongoUri = text('ADMIN_MONGO_URI');
  if (adminMongoUri && !/^mongodb(?:\+srv)?:\/\//.test(adminMongoUri))
    throw new Error('ADMIN_MONGO_URI must be a MongoDB connection URI');
  const adminMongoDb = text('ADMIN_MONGO_DB', 'remote_cooperative');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(adminMongoDb))
    throw new Error('ADMIN_MONGO_DB must be a valid database name');

  return {
    NODE_ENV: nodeEnv as Environment['NODE_ENV'],
    PORT: integer('PORT', 3000, 65535),
    CORS_ORIGINS: [...new Set(origins)],
    HTTP_BODY_LIMIT_KB: integer('HTTP_BODY_LIMIT_KB', 64, 1024),
    RATE_LIMIT_TTL_MS: integer('RATE_LIMIT_TTL_MS', 60000, 3600000),
    RATE_LIMIT_MAX: integer('RATE_LIMIT_MAX', 100, 10000),
    RATE_LIMIT_BURST_MAX: integer('RATE_LIMIT_BURST_MAX', 10, 1000),
    REMOTE_AGRIC_API_URL: remoteApi,
    REMOTE_AGRIC_ORIGIN: remoteOrigin,
    GOOGLE_CLIENT_ID: googleId,
    GOOGLE_CLIENT_SECRET: googleSecret,
    GOOGLE_REDIRECT_URI: googleRedirect,
    ADMIN_MONGO_URI: adminMongoUri,
    ADMIN_MONGO_DB: adminMongoDb,
    ADMIN_SESSION_TTL_HOURS: integer('ADMIN_SESSION_TTL_HOURS', 8, 24),
  };
}
