import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { sessionToken } from './session.js';
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
    const admin =
      this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const token = sessionToken(request, admin);
    if (!token) throw new UnauthorizedException();
    if (admin) {
      request.admin = await this.admins.identity(token);
    } else {
      request.user = await this.remote.identity(token);
    }
    return true;
  }
}
