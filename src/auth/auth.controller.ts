import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/security/public.decorator.js';
import {
  EmailDto,
  GoogleDto,
  GoogleStartDto,
  LoginDto,
  ResetDto,
  SignupDto,
  VerifyDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { RemoteAgricService } from './remote-agric.service.js';

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AuthController {
  constructor(
    private readonly remote: RemoteAgricService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Post('signup')
  @HttpCode(202)
  async signup(@Body() body: SignupDto) {
    const { acceptTerms: _acceptTerms, ...registration } = body;
    await this.remote.request('auth/register', registration);
    return { requiresVerification: true };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verify(@Body() body: VerifyDto) {
    await this.remote.request('auth/register/verify-otp', body);
    return { verified: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.remote.login(body);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgot(@Body() body: EmailDto) {
    await this.remote.request('auth/forgot-password', body);
    return { sent: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async reset(@Body() body: ResetDto) {
    await this.remote.request('auth/reset-password', body);
    return { reset: true };
  }

  @Public()
  @Post('google/start')
  @HttpCode(200)
  start(@Body() body: GoogleStartDto) {
    return this.auth.googleStart(body);
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  google(@Body() body: GoogleDto) {
    return this.auth.google(body);
  }

  @Get('me')
  me(@Req() req: Request & { user: unknown }) {
    return { user: req.user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    await this.remote.request(
      'auth/logout',
      {},
      req.headers.authorization!.slice(7),
    );
    return { loggedOut: true };
  }
}
