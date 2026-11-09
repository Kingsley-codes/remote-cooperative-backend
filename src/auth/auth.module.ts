import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RemoteAgricService } from './remote-agric.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, RemoteAgricService],
  exports: [RemoteAgricService],
})
export class AuthModule {}
