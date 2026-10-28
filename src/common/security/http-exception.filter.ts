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
    if (!response.headersSent) {
      response.status(status).json({
        statusCode: status,
        message: STATUS_CODES[status] ?? 'Request failed',
        requestId,
      });
    }
  }
}
