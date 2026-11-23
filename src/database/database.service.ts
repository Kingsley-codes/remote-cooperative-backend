import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Db, type ClientSession, MongoClient } from 'mongodb';
import type { Environment } from '../config/environment.js';
import { dependencyFailureReason } from '../common/security/dependency-failure.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private client?: MongoClient;
  private ready?: Promise<Db>;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async db(): Promise<Db> {
    if (!this.ready) {
      this.ready = this.connect().catch(() => {
        this.ready = undefined;
        throw new ServiceUnavailableException();
      });
    }
    return this.ready;
  }

  // Financial writes span a domain record and its ledger entry. A replica set
  // (including Atlas) is required; never fall back to partial writes.
  async atomic<T>(
    work: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const db = await this.db();
    return this.client!.withSession((session) =>
      session.withTransaction(() => work(db, session)),
    );
  }

  private async connect(): Promise<Db> {
    const uri = this.config.get('MONGO_URI', { infer: true });
    // Keep public routes available without a configured database.
    if (!uri) {
      this.logger.error({
        event: 'database_unavailable',
        reason: 'missing_mongo_uri',
      });
      throw new ServiceUnavailableException();
    }
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
    this.client = client;
    let stage = 'connect';
    try {
      await client.connect();
      const db = client.db();
      stage = 'initialize_indexes';
      await Promise.all([
        db
          .collection('financeSettings')
          .createIndex({ key: 1 }, { unique: true }),
        ...['contributions', 'transactions', 'loans'].map((name) =>
          db
            .collection(name)
            .createIndex({ id: 1 }, { unique: true, sparse: true }),
        ),
        db
          .collection('contributions')
          .createIndex({ reference: 1 }, { unique: true }),
        db
          .collection('contributions')
          .createIndex({ memberId: 1, type: 1, createdAt: -1 }),
        db
          .collection('transactions')
          .createIndex({ reference: 1 }, { unique: true }),
        db
          .collection('transactions')
          .createIndex({ memberId: 1, idempotencyKey: 1 }, { unique: true }),
        db
          .collection('transactions')
          .createIndex({ memberId: 1, createdAt: -1 }),
        db.collection('loans').createIndex({ memberId: 1, createdAt: -1 }),
        db
          .collection('loanEligibility')
          .createIndex({ memberId: 1 }, { unique: true }),
        db.collection('admins').createIndex({ email: 1 }, { unique: true }),
        db
          .collection('users')
          .createIndex({ remoteAgricUserId: 1 }, { unique: true }),
      ]);
      return db;
    } catch (error) {
      this.logger.error({
        event: 'database_unavailable',
        stage,
        reason: dependencyFailureReason(error),
      });
      await client.close();
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.client?.close();
  }
}
