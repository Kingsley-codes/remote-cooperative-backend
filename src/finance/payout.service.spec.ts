import { ConfigService } from '@nestjs/config';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service.js';
import { FinanceService } from './finance.service.js';
import { PayoutService } from './payout.service.js';
import { PaystackService } from './paystack.service.js';
import type { MemberIdentity, Transaction } from './finance.model.js';

describe('Payout balance reservations', () => {
  const member: MemberIdentity = {
    localUserId: '0123456789abcdef01234567',
    email: 'member@example.com',
    membershipStatus: 'active',
    termsVersion: '1.0',
    currentTermsVersion: '1.0',
  };
  function setup() {
    let reserved = 0;
    let record: Transaction | null = null;
    const users = {
      findOneAndUpdate: vi.fn(async () => ({
        payout: {
          recipientCode: 'RCP_verified',
          name: 'Member Name',
          last4: '1234',
        },
      })),
    };
    const contributions = {
      aggregate: vi.fn(() => ({ next: async () => ({ amount: 10000 }) })),
    };
    const transactions = {
      findOne: vi.fn(async () => record),
      aggregate: vi.fn(() => ({ next: async () => ({ amount: reserved }) })),
      insertOne: vi.fn(async (transaction: Transaction) => {
        record = transaction;
        reserved += transaction.amount;
      }),
      updateOne: vi.fn(
        async (
          filter: { status: string },
          update: { $set: Partial<Transaction> },
        ) => {
          if (!record || filter.status !== record.status)
            return { modifiedCount: 0 };
          Object.assign(record, update.$set);
          if (record.status === 'failed') reserved -= record.amount;
          return { modifiedCount: 1 };
        },
      ),
    };
    const db = {
      collection: (name: string) =>
        ({ users, contributions, transactions })[name],
    };
    const database = {
      db: async () => db,
      atomic: async (
        work: (db: unknown, session: object) => Promise<unknown>,
      ) => work(db, {}),
    };
    const paystack = {
      request: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(
        async () => {
          throw new Error('Timeout after send');
        },
      ),
    };
    const finance = { active: vi.fn() };
    const service = new PayoutService(
      database as unknown as DatabaseService,
      paystack as unknown as PaystackService,
      finance as unknown as FinanceService,
      new ConfigService({ PAYSTACK_TRANSFERS_ENABLED: 'true' }),
    );
    return {
      service,
      paystack,
      transactions,
      getRecord: () => record!,
      reserved: () => reserved,
    };
  }
  it('does not call the payout provider when the amount exceeds available funds', async () => {
    const f = setup();
    await expect(
      f.service.withdraw(member, 10001, 'valid-withdrawal-key'),
    ).rejects.toThrow('Amount exceeds');
    expect(f.paystack.request).not.toHaveBeenCalled();
    expect(f.transactions.insertOne).not.toHaveBeenCalled();
  });
  it('preserves the reservation and reference after an ambiguous provider timeout', async () => {
    const f = setup();
    const response = await f.service.withdraw(
      member,
      10000,
      'valid-withdrawal-key',
    );
    expect(response).toMatchObject({ status: 'pending', amount: 10000 });
    expect(f.reserved()).toBe(10000);
    expect(response).not.toHaveProperty('recipientCode');
    const original = f.getRecord().reference;
    await expect(
      f.service.withdraw(member, 10000, 'valid-withdrawal-key'),
    ).rejects.toThrow();
    expect(f.transactions.insertOne).toHaveBeenCalledTimes(1);
    expect(f.getRecord().reference).toBe(original);
    expect(f.paystack.request.mock.calls[1]?.[0]).toBe(
      `/transfer/verify/${original}`,
    );
  });
  it('releases a failed payout only after provider verification, once', async () => {
    const f = setup();
    await f.service.withdraw(member, 10000, 'valid-withdrawal-key');
    const record = f.getRecord();
    f.paystack.request.mockImplementation(
      async () =>
        ({
          amount: record.amount,
          currency: 'NGN',
          reference: record.reference,
          recipient: { recipient_code: 'RCP_verified' },
          status: 'failed',
          transfer_code: 'TRF_failed',
        }) as never,
    );
    await f.service.verify(record.reference, member.localUserId);
    await f.service.verify(record.reference, member.localUserId);
    expect(f.reserved()).toBe(0);
    expect(record.status).toBe('failed');
  });
  it('does not release funds for a payout with a mismatched destination', async () => {
    const f = setup();
    await f.service.withdraw(member, 10000, 'valid-withdrawal-key');
    const record = f.getRecord();
    f.paystack.request.mockImplementation(
      async () =>
        ({
          amount: record.amount,
          currency: 'NGN',
          reference: record.reference,
          recipient: { recipient_code: 'RCP_other' },
          status: 'failed',
        }) as never,
    );
    await expect(f.service.verify(record.reference)).rejects.toThrow(
      'Payout details do not match',
    );
    expect(record.status).toBe('pending');
    expect(f.reserved()).toBe(10000);
  });
  it('keeps automated payouts disabled unless explicitly enabled', async () => {
    const service = new PayoutService(
      {} as DatabaseService,
      {} as PaystackService,
      { active: () => {} } as unknown as FinanceService,
      new ConfigService(),
    );
    await expect(
      service.withdraw(member, 100, new ObjectId().toHexString()),
    ).rejects.toThrow('Payouts are not enabled');
  });
});
