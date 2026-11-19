import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import { cookieName, cookieOptions } from './session.js';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService<Environment, true>) {}
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = response.getHeader('X-Request-Id');
    if (status >= 500) {
      // Do not log raw exceptions, request bodies, query strings, or credentials.
      this.logger.error({
        event: 'http_error',
        requestId,
        statusCode: status,
        method: request.method,
      });
    }
    if (
      !response.headersSent &&
      request.method === 'POST' &&
      /^\/(admin\/)?auth\/logout$/.test(request.path) &&
      [401, 403].includes(status)
    ) {
      response.clearCookie(
        cookieName(request.path.startsWith('/admin/') ? 'admin' : 'session'),
        cookieOptions(this.config),
      );
      response.status(200).json({ loggedOut: true });
      return;
    }
    if (!response.headersSent) {
      response.status(status).json({
        statusCode: status,
        message: this.message(request, status),
        requestId,
      });
    }
  }
  private message(request: Request, status: number) {
    if (request.path.startsWith('/admin/auth/')) {
      return status === 401
        ? 'Incorrect admin email or password.'
        : status === 429
          ? 'Too many attempts. Please wait a minute before trying again.'
          : status === 403
            ? 'This request is not allowed.'
            : 'Admin sign in is temporarily unavailable. Please try again.';
    }
    if (request.path.startsWith('/auth/')) {
      if (request.path === '/auth/accept-terms' && status === 400)
        return 'The membership terms may have changed. Refresh this page, review them, and try again.';
      const messages: Record<number, string> = {
        400: 'Check your details and verification code, then try again. The email may already be registered.',
        401: 'Sign in failed. Check your credentials and make sure your email is verified.',
        403: 'Unable to access this account. Try signing in with your password or contact support.',
        409: 'This email is already registered. Sign in instead.',
        429: 'Too many attempts. Please wait a minute and try again.',
      };
      return (
        messages[status] ??
        'The account service is temporarily unavailable. Please try again.'
      );
    }
    return STATUS_CODES[status] ?? 'Request failed';
  }
}
