import { Global, Module } from '@nestjs/common';
import { BrowserOAuthController } from './browser-oauth.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RemoteAgricService } from './remote-agric.service.js';
import { UsersModule } from '../users/users.module.js';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [AuthController, BrowserOAuthController],
  providers: [AuthService, RemoteAgricService],
  exports: [RemoteAgricService],
})
export class AuthModule {}
