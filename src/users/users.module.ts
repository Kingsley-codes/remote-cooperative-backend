import { Module } from '@nestjs/common';
import { UserStore } from './user.store.js';

@Module({ providers: [UserStore], exports: [UserStore] })
export class UsersModule {}
