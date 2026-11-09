import {
  BadGatewayException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

export interface RemoteUser {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  farmerID: string;
  status: string;
  isVerified: boolean;
}

interface RemoteResponse {
  message?: string;
  data?: { user?: RemoteUser };
}

@Injectable()
export class RemoteAgricService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async request(path: string, body?: unknown, token?: string) {
    const base = this.config.get('REMOTE_AGRIC_API_URL', { infer: true });
    if (!base) throw new ServiceUnavailableException();
    let response: Response;
    try {
      response = await fetch(`${base}/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Cookie: `user_token=${token}` } : {}),
          ...(body !== undefined
            ? {
                Origin: this.config.get('REMOTE_AGRIC_ORIGIN', { infer: true }),
              }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException();
    }
    // Do not expose upstream cookies, errors, or full user documents to browsers.
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          throw new BadGatewayException();
        }
        chunks.push(value);
      }
    } catch {
      throw new BadGatewayException();
    } finally {
      reader.releaseLock();
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let data: RemoteResponse;
    try {
      data = JSON.parse(raw) as RemoteResponse;
    } catch {
      throw new BadGatewayException();
    }
    if (!response.ok) {
      const status = [400, 401, 403, 409, 429].includes(response.status)
        ? response.status
        : 502;
      throw new HttpException('Remote Agric request failed', status);
    }
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('user_token='));
    const sessionToken = cookie?.split(';')[0]?.slice('user_token='.length);
    return { data, sessionToken };
  }

  async identity(token: string) {
    if (
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      token.length > 8192
    ) {
      throw new UnauthorizedException();
    }
    const { data } = await this.request('user/profile', undefined, token);
    const user = data.data?.user;
    if (!user?._id || user.status !== 'active' || !user.isVerified)
      throw new UnauthorizedException();
    return this.publicUser(user);
  }

  publicUser(user: RemoteUser) {
    return {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      farmerID: user.farmerID,
    };
  }

  async login(body: unknown, path = 'auth/login') {
    const { data, sessionToken } = await this.request(path, body);
    if (!sessionToken || !data.data?.user) throw new BadGatewayException();
    return { sessionToken, user: this.publicUser(data.data.user) };
  }
}
