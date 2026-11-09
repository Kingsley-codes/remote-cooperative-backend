import { Global, Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminStore } from './admin.store.js';

@Global()
@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminStore],
  exports: [AdminService],
})
export class AdminModule {}
