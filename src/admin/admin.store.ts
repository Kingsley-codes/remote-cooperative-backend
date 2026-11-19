import { Injectable } from '@nestjs/common';
import type { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service.js';
import type { AdminAccount, AdminSession } from './admin.model.js';

@Injectable()
export class AdminStore {
  constructor(private readonly database: DatabaseService) {}

  async findByEmail(email: string) {
    return (await this.database.db())
      .collection<AdminAccount>('admins')
      .findOne({ email });
  }
  async findById(id: ObjectId) {
    return (await this.database.db())
      .collection<AdminAccount>('admins')
      .findOne({ _id: id });
  }
  async createSession(session: AdminSession) {
    await (
      await this.database.db()
    )
      .collection<AdminSession>('admin_sessions')
      .insertOne(session);
  }
  async findSession(hash: string) {
    return (await this.database.db())
      .collection<AdminSession>('admin_sessions')
      .findOne({ _id: hash, expiresAt: { $gt: new Date() } });
  }
  async deleteSession(hash: string) {
    await (
      await this.database.db()
    )
      .collection<AdminSession>('admin_sessions')
      .deleteOne({ _id: hash });
  }
}
