import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Db, MongoClient, ObjectId } from 'mongodb';
import type { Environment } from '../config/environment.js';

export interface AdminAccount {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  active: boolean;
  sessionVersion: number;
  createdAt: Date;
}
export interface AdminSession {
  _id: string;
  adminId: ObjectId;
  sessionVersion: number;
  expiresAt: Date;
}

@Injectable()
export class AdminStore implements OnModuleDestroy {
  private client?: MongoClient;
  private ready?: Promise<Db>;
  constructor(private readonly config: ConfigService<Environment, true>) {}

  private async db(): Promise<Db> {
    if (!this.ready) {
      const uri = this.config.get('ADMIN_MONGO_URI', { infer: true });
      if (!uri) throw new ServiceUnavailableException();
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 10000,
      });
      this.client = client;
      this.ready = (async () => {
        try {
          await client.connect();
          const db = client.db(
            this.config.get('ADMIN_MONGO_DB', { infer: true }),
          );
          await db
            .collection('admins')
            .createIndex({ email: 1 }, { unique: true });
          await db
            .collection('admin_sessions')
            .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
          return db;
        } catch {
          await client.close();
          this.ready = undefined;
          throw new ServiceUnavailableException();
        }
      })();
    }
    return this.ready;
  }

  async findByEmail(email: string) {
    return (await this.db())
      .collection<AdminAccount>('admins')
      .findOne({ email });
  }
  async findById(id: ObjectId) {
    return (await this.db())
      .collection<AdminAccount>('admins')
      .findOne({ _id: id });
  }
  async createSession(session: AdminSession) {
    await (
      await this.db()
    )
      .collection<AdminSession>('admin_sessions')
      .insertOne(session);
  }
  async findSession(hash: string) {
    return (await this.db())
      .collection<AdminSession>('admin_sessions')
      .findOne({ _id: hash, expiresAt: { $gt: new Date() } });
  }
  async deleteSession(hash: string) {
    await (
      await this.db()
    )
      .collection<AdminSession>('admin_sessions')
      .deleteOne({ _id: hash });
  }
  async onModuleDestroy() {
    await this.client?.close();
  }
}
