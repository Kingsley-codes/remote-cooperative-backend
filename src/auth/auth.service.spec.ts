import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AuthService } from './auth.service.js';
import { RemoteAgricService } from './remote-agric.service.js';
import type { Environment } from '../config/environment.js';

describe('Google authentication', () => {
  const config = new ConfigService<Environment, true>({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:4000/auth/google/callback',
  });
  const remote = { login: vi.fn() };
  const service = new AuthService(
    config,
    remote as unknown as RemoteAgricService,
  );
  afterEach(() => {
    vi.restoreAllMocks();
    remote.login.mockReset();
  });

  it('requests OpenID scopes and binds authorization to state, nonce, PKCE and the fixed callback', () => {
    const { url } = service.googleStart({
      state: 'state',
      nonce: 'nonce',
      codeChallenge: 'challenge',
    });
    const params = new URL(url).searchParams;
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('state')).toBe('state');
    expect(params.get('nonce')).toBe('nonce');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('redirect_uri')).toBe(
      'http://localhost:4000/auth/google/callback',
    );
  });
  it.each([
    { sub: 'id', email_verified: true, nonce: 'wrong' },
    { sub: 'id', email_verified: false, nonce: 'nonce' },
  ])(
    'rejects an invalid Google identity before provisioning: %j',
    async (profile) => {
      vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
        tokens: { id_token: 'signed-token' },
      } as never);
      vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
        getPayload: () => profile,
      } as never);
      await expect(
        service.google({
          code: 'code',
          codeVerifier: 'verifier',
          nonce: 'nonce',
        }),
      ).rejects.toThrow();
      expect(remote.login).not.toHaveBeenCalled();
    },
  );
  it('passes only the verified Google token to the authoritative user backend', async () => {
    vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
      tokens: { id_token: 'signed-token' },
    } as never);
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: 'id', email_verified: true, nonce: 'nonce' }),
    } as never);
    remote.login.mockResolvedValue({ sessionToken: 'session' });
    await expect(
      service.google({
        code: 'code',
        codeVerifier: 'verifier',
        nonce: 'nonce',
      }),
    ).resolves.toEqual({ sessionToken: 'session' });
    expect(remote.login).toHaveBeenCalledWith(
      { idToken: 'signed-token' },
      'auth/google/token',
    );
  });
});
