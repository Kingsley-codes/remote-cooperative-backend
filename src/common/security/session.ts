import type { Request, Response, CookieOptions } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';

export function cookieName(kind: 'session' | 'admin' | 'oauth') {
  return `${process.env.NODE_ENV === 'production' ? '__Host-' : ''}cooperative_${kind}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export function sessionToken(request: Request, admin = false) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : readCookie(request, cookieName(admin ? 'admin' : 'session'));
}

export function cookieOptions(
  config: ConfigService<Environment, true>,
  oauth = false,
): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get('NODE_ENV', { infer: true }) === 'production',
    sameSite: oauth ? 'lax' : config.get('COOKIE_SAME_SITE', { infer: true }),
    path: '/',
  };
}

export function setSession(
  response: Response,
  config: ConfigService<Environment, true>,
  token: string,
  admin = false,
  maxAge = 604800,
) {
  response.cookie(cookieName(admin ? 'admin' : 'session'), token, {
    ...cookieOptions(config),
    maxAge: maxAge * 1000,
  });
}
