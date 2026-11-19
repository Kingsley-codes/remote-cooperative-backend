import { Controller, Get, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Public } from '../common/security/public.decorator.js';
import {
  cookieName,
  cookieOptions,
  readCookie,
  setSession,
} from '../common/security/session.js';
import type { Environment } from '../config/environment.js';
import { AuthService } from './auth.service.js';

@Public()
@Controller('auth/google')
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class BrowserOAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Get()
  start(@Res() response: Response) {
    response.setHeader('Referrer-Policy', 'no-referrer');
    const origin = this.config.get('APP_ORIGIN', { infer: true });
    try {
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
      const { url } = this.auth.googleStart({ state, nonce, codeChallenge });
      if (new URL(url).origin !== 'https://accounts.google.com')
        throw new Error('Invalid authorization origin');
      response.cookie(
        cookieName('oauth'),
        JSON.stringify({
          state,
          nonce,
          codeVerifier,
          expires: Date.now() + 600000,
        }),
        { ...cookieOptions(this.config, true), maxAge: 600000 },
      );
      return response.redirect(303, url);
    } catch {
      return response.redirect(303, `${origin}/login?error=google_unavailable`);
    }
  }

  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Referrer-Policy', 'no-referrer');
    const origin = this.config.get('APP_ORIGIN', { infer: true });
    response.clearCookie(cookieName('oauth'), cookieOptions(this.config, true));
    try {
      const flow = JSON.parse(
        readCookie(request, cookieName('oauth')) ?? 'null',
      ) as {
        state: string;
        nonce: string;
        codeVerifier: string;
        expires: number;
      } | null;
      const { state, code, error } = request.query;
      if (
        !flow ||
        typeof flow.expires !== 'number' ||
        !Number.isFinite(flow.expires) ||
        flow.expires < Date.now() ||
        typeof flow.nonce !== 'string' ||
        !/^[\w-]{43}$/.test(flow.nonce) ||
        typeof flow.codeVerifier !== 'string' ||
        !/^[\w-]{43}$/.test(flow.codeVerifier) ||
        typeof state !== 'string' ||
        typeof code !== 'string' ||
        error !== undefined ||
        typeof flow.state !== 'string' ||
        Buffer.byteLength(state) !== Buffer.byteLength(flow.state) ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))
      )
        throw new Error('Invalid OAuth state');
      const { sessionToken, user } = await this.auth.google({
        code,
        codeVerifier: flow.codeVerifier,
        nonce: flow.nonce,
      });
      if (!sessionToken) throw new Error('Missing session');
      setSession(response, this.config, sessionToken);
      return response.redirect(
        303,
        `${origin}${user.membershipStatus === 'active' ? '/dashboard' : '/onboarding'}`,
      );
    } catch {
      return response.redirect(303, `${origin}/login?error=google_failed`);
    }
  }
}
