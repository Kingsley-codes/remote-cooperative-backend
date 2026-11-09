import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { Environment } from '../config/environment.js';
import type { GoogleDto, GoogleStartDto } from './auth.dto.js';
import { RemoteAgricService } from './remote-agric.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly remote: RemoteAgricService,
  ) {}

  private googleClient() {
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET', {
      infer: true,
    });
    const redirectUri = this.config.get('GOOGLE_REDIRECT_URI', { infer: true });
    if (!clientId || !clientSecret || !redirectUri)
      throw new ServiceUnavailableException();
    return new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri,
      transporterOptions: { timeout: 10000 },
    });
  }

  googleStart(body: GoogleStartDto) {
    return {
      url: this.googleClient().generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state: body.state,
        nonce: body.nonce,
        code_challenge: body.codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        prompt: 'select_account',
      }),
    };
  }

  async google(body: GoogleDto) {
    const client = this.googleClient();
    let idToken: string;
    try {
      const { tokens } = await client.getToken({
        code: body.code,
        codeVerifier: body.codeVerifier,
      });
      if (!tokens.id_token) throw new Error('Missing ID token');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      });
      const profile = ticket.getPayload();
      if (
        !profile?.sub ||
        !profile.email_verified ||
        profile.nonce !== body.nonce
      )
        throw new Error('Invalid Google identity');
      idToken = tokens.id_token;
    } catch {
      throw new UnauthorizedException();
    }
    return this.remote.login({ idToken }, 'auth/google/token');
  }
}
