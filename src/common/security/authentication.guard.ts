import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from './public.decorator.js';
import { RemoteAgricService } from '../../auth/remote-agric.service.js';
import type { Request } from 'express';
import { ADMIN_ONLY } from '../../admin/admin.decorator.js';
import { AdminService } from '../../admin/admin.service.js';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly remote: RemoteAgricService,
    private readonly admins: AdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown; admin?: unknown }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException();
    if (
      this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      request.admin = await this.admins.identity(authorization.slice(7));
    } else {
      request.user = await this.remote.identity(authorization.slice(7));
    }
    return true;
  }
}
