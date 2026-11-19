import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
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
  private signingKey() {
    const secret = this.config.get('ADMIN_TOKEN_SECRET', { infer: true });
    if (!secret) throw new ServiceUnavailableException();
    return new TextEncoder().encode(secret);
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
    const maxAge =
      this.config.get('ADMIN_SESSION_TTL_HOURS', { infer: true }) * 3600;
    const sessionToken = `admin_${await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(admin._id.toHexString())
      .setIssuer('remote-cooperative-backend')
      .setAudience('cooperative-admin')
      .setIssuedAt()
      .setExpirationTime(`${maxAge}s`)
      .sign(this.signingKey())}`;
    return { sessionToken, maxAge, admin: this.profile(admin) };
  }

  async identity(token: string) {
    if (!token.startsWith('admin_') || token.length > 2048)
      throw new UnauthorizedException();
    const key = this.signingKey();
    let adminId: string;
    try {
      const { payload } = await jwtVerify(token.slice(6), key, {
        algorithms: ['HS256'],
        typ: 'JWT',
        issuer: 'remote-cooperative-backend',
        audience: 'cooperative-admin',
        requiredClaims: ['sub', 'iat', 'exp'],
      });
      if (!payload.sub || !/^[a-f0-9]{24}$/.test(payload.sub))
        throw new UnauthorizedException();
      adminId = payload.sub;
    } catch {
      throw new UnauthorizedException();
    }
    const admin = await this.store.findById(new ObjectId(adminId));
    if (!admin?.active) throw new UnauthorizedException();
    return this.profile(admin);
  }
}
