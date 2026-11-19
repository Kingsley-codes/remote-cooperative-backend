import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { map } from 'rxjs';
import type { Environment } from '../../config/environment.js';
import { cookieName, cookieOptions, setSession } from './session.js';

// Tokens never enter browser JavaScript, including on legacy JSON auth routes.
export class BrowserSessionInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService<Environment, true>) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        const admin = request.path.startsWith('/admin/');
        if (
          request.method === 'POST' &&
          /^\/(admin\/)?auth\/logout$/.test(request.path)
        ) {
          response.clearCookie(
            cookieName(admin ? 'admin' : 'session'),
            cookieOptions(this.config),
          );
        }
        if (data && typeof data === 'object' && 'sessionToken' in data) {
          const { sessionToken, maxAge, ...publicData } = data as {
            sessionToken: string;
            maxAge?: number;
            [key: string]: unknown;
          };
          setSession(response, this.config, sessionToken, admin, maxAge);
          return publicData;
        }
        return data;
      }),
    );
  }
}
