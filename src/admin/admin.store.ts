import { Injectable } from '@nestjs/common';
import type { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service.js';
import type { AdminAccount } from './admin.model.js';

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
}
