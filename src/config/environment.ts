export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  CORS_ORIGINS: string[];
  APP_ORIGIN: string;
  COOKIE_SAME_SITE: 'lax' | 'none';
  HTTP_BODY_LIMIT_KB: number;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_BURST_MAX: number;
  REMOTE_AGRIC_API_URL: string;
  REMOTE_AGRIC_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  MONGO_URI: string;
  ADMIN_SESSION_TTL_HOURS: number;
  ADMIN_TOKEN_SECRET: string;
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
  const appOrigin = httpUrl('APP_ORIGIN', origins[0], true);
  if (!origins.includes(appOrigin))
    throw new Error('APP_ORIGIN must be in CORS_ORIGINS');
  const sameSite = text('COOKIE_SAME_SITE', 'lax');
  if (
    !['lax', 'none'].includes(sameSite) ||
    (sameSite === 'none' && nodeEnv !== 'production')
  )
    throw new Error(
      'COOKIE_SAME_SITE must be lax, or none with production HTTPS',
    );
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
    new URL(googleRedirect).pathname !== '/auth/google/callback'
  ) {
    throw new Error(
      'GOOGLE_REDIRECT_URI must use the backend URL and /auth/google/callback',
    );
  }
  if (remoteApi && !remoteOrigin)
    throw new Error(
      'REMOTE_AGRIC_ORIGIN is required with REMOTE_AGRIC_API_URL',
    );

  const mongoUri = text('MONGO_URI');
  if (mongoUri) {
    // MongoClient parses credentials, hosts, and options; require an explicit
    // database here so an omitted name cannot silently select MongoDB's "test".
    const database =
      /^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^?#]+)(?:\?[^#]*)?$/.exec(
        mongoUri,
      )?.[1];
    if (!database || !/^[a-zA-Z0-9_-]{1,64}$/.test(database))
      throw new Error(
        'MONGO_URI must be a MongoDB URI including a database name',
      );
  }

  const adminTokenSecret = text('ADMIN_TOKEN_SECRET');
  if (adminTokenSecret && Buffer.byteLength(adminTokenSecret) < 32)
    throw new Error('ADMIN_TOKEN_SECRET must contain at least 32 bytes');

  return {
    NODE_ENV: nodeEnv as Environment['NODE_ENV'],
    PORT: integer('PORT', 3000, 65535),
    CORS_ORIGINS: [...new Set(origins)],
    APP_ORIGIN: appOrigin,
    COOKIE_SAME_SITE: sameSite as Environment['COOKIE_SAME_SITE'],
    HTTP_BODY_LIMIT_KB: integer('HTTP_BODY_LIMIT_KB', 64, 1024),
    RATE_LIMIT_TTL_MS: integer('RATE_LIMIT_TTL_MS', 60000, 3600000),
    RATE_LIMIT_MAX: integer('RATE_LIMIT_MAX', 100, 10000),
    RATE_LIMIT_BURST_MAX: integer('RATE_LIMIT_BURST_MAX', 10, 1000),
    REMOTE_AGRIC_API_URL: remoteApi,
    REMOTE_AGRIC_ORIGIN: remoteOrigin,
    GOOGLE_CLIENT_ID: googleId,
    GOOGLE_CLIENT_SECRET: googleSecret,
    GOOGLE_REDIRECT_URI: googleRedirect,
    MONGO_URI: mongoUri,
    ADMIN_SESSION_TTL_HOURS: integer('ADMIN_SESSION_TTL_HOURS', 8, 24),
    ADMIN_TOKEN_SECRET: adminTokenSecret,
  };
}
