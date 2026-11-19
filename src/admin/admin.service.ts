import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { AdminStore } from './admin.store.js';
import type { AdminAccount } from './admin.model.js';
import { verifyPassword } from './password.js';
import type { Environment } from '../config/environment.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly store: AdminStore,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private profile(admin: AdminAccount) {
    return {
      id: admin._id.toHexString(),
      email: admin.email,
      name: admin.name,
      role: 'admin' as const,
    };
  }

  async login(email: string, password: string) {
    const admin = await this.store.findByEmail(email);
    const matches = await verifyPassword(password, admin?.passwordHash);
    if (!admin || !matches || !admin.active) throw new UnauthorizedException();
    const sessionToken = `admin_${randomBytes(32).toString('base64url')}`;
    const maxAge =
      this.config.get('ADMIN_SESSION_TTL_HOURS', { infer: true }) * 3600;
    await this.store.createSession({
      _id: this.digest(sessionToken),
      adminId: admin._id,
      sessionVersion: admin.sessionVersion,
      expiresAt: new Date(Date.now() + maxAge * 1000),
    });
    return { sessionToken, maxAge, admin: this.profile(admin) };
  }

  async identity(token: string) {
    if (!/^admin_[\w-]{43}$/.test(token)) throw new UnauthorizedException();
    const session = await this.store.findSession(this.digest(token));
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException();
    const admin = await this.store.findById(session.adminId);
    if (!admin?.active || admin.sessionVersion !== session.sessionVersion)
      throw new UnauthorizedException();
    return this.profile(admin);
  }
  async logout(token: string) {
    await this.store.deleteSession(this.digest(token));
    return { loggedOut: true };
  }
}
