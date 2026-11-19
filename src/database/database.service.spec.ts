import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service.js';
import type { Environment } from '../config/environment.js';

const mongo = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  db: vi.fn(),
  createIndex: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('mongodb', () => ({
  MongoClient: class {
    constructor(uri: string) {
      mongo.construct(uri);
    }
    connect = mongo.connect;
    close = mongo.close;
    db = mongo.db;
  },
}));

describe('shared cooperative database', () => {
  const uri = 'mongodb://localhost:27017/remote_cooperative';
  const database = {
    collection: vi.fn((_name: string) => ({ createIndex: mongo.createIndex })),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    mongo.connect.mockResolvedValue(undefined);
    mongo.close.mockResolvedValue(undefined);
    mongo.db.mockReturnValue(database);
    mongo.createIndex.mockResolvedValue('index');
  });

  it('shares one connection and selects the URI database for all collections', async () => {
    const service = new DatabaseService(
      new ConfigService<Environment, true>({ MONGO_URI: uri }),
    );
    const results = await Promise.all([service.db(), service.db()]);
    expect(results).toEqual([database, database]);
    expect(mongo.construct).toHaveBeenCalledExactlyOnceWith(uri);
    expect(mongo.db).toHaveBeenCalledWith();
    expect(database.collection.mock.calls.map(([name]) => name)).toEqual([
      'admins',
      'users',
    ]);
    expect(mongo.createIndex).toHaveBeenCalledWith(
      { remoteAgricUserId: 1 },
      { unique: true },
    );
    await service.onModuleDestroy();
    expect(mongo.close).toHaveBeenCalledOnce();
  });

  it('closes failed connections, hides connection details, and retries on the next request', async () => {
    mongo.connect.mockRejectedValueOnce(new Error('secret connection details'));
    const service = new DatabaseService(
      new ConfigService<Environment, true>({ MONGO_URI: uri }),
    );
    await expect(service.db()).rejects.toThrow('Service Unavailable');
    expect(mongo.close).toHaveBeenCalledOnce();
    await expect(service.db()).resolves.toBe(database);
    expect(mongo.construct).toHaveBeenCalledTimes(2);
  });

  it('fails safely without MONGO_URI and allows configuration to be corrected', async () => {
    const config = new ConfigService<Environment, true>({ MONGO_URI: '' });
    const service = new DatabaseService(config);
    await expect(service.db()).rejects.toThrow('Service Unavailable');
    expect(mongo.construct).not.toHaveBeenCalled();
    config.set('MONGO_URI', uri);
    await expect(service.db()).resolves.toBe(database);
  });
});
