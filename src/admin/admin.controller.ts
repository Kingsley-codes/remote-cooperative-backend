import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../common/security/public.decorator.js';
import { AdminOnly } from './admin.decorator.js';
import { AdminService } from './admin.service.js';

export class AdminLoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}

@Controller('admin/auth')
@AdminOnly()
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() body: AdminLoginDto) {
    return this.service.login(body.email, body.password);
  }

  @Get('me')
  me(@Req() request: Request & { admin: unknown }) {
    return { admin: request.admin };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() request: Request) {
    return this.service.logout(request.headers.authorization!.slice(7));
  }
}
