import { ConfigService } from '@nestjs/config';
import { ObjectId } from 'mongodb';
import { createHmac } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceService,
  objectId,
  paymentKey,
  repaymentSchedule,
} from './finance.service.js';
import { PaystackService } from './paystack.service.js';
import type { MemberIdentity, Transaction } from './finance.model.js';

const member: MemberIdentity = {
  localUserId: '0123456789abcdef01234567',
  email: 'member@example.com',
  membershipStatus: 'active',
  termsVersion: '1.0',
  currentTermsVersion: '1.0',
};
function fixture(category: Transaction['category'] = 'long_term') {
  const transaction: Transaction = {
    _id: new ObjectId(),
    memberId: member.localUserId,
    email: member.email,
    category,
    direction: 'in',
    amount: 10000,
    currency: 'NGN',
    reference: 'coop_12345678-1234-1234-1234-123456789012',
    linkedId: new ObjectId().toHexString(),
    idempotencyKey: 'payment-request-key',
    status: 'pending',
    reconciliation: 'unmatched',
    createdAt: new Date(),
  };
  const loan = {
    _id: objectId(transaction.linkedId),
    totalDue: 10000,
    repaidAmount: 0,
    reservedRepayment: 10000,
    status: 'active',
  };
  const contribution = { status: 'pending', paidAt: null };
  const transactions = {
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      filter.memberId && filter.memberId !== member.localUserId
        ? null
        : { ...transaction },
    ),
    updateOne: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set: Partial<Transaction> },
      ) => {
        if (filter.status && filter.status !== transaction.status)
          return { modifiedCount: 0 };
        Object.assign(transaction, update.$set);
        return { modifiedCount: 1 };
      },
    ),
  };
  const contributions = {
    updateOne: vi.fn(async (_filter: unknown, update: { $set: object }) => {
      Object.assign(contribution, update.$set);
      return { modifiedCount: 1 };
    }),
  };
  const loans = {
    findOneAndUpdate: vi.fn(
      async (
        _filter: unknown,
        update: { $inc: { repaidAmount: number; reservedRepayment: number } },
      ) => {
        loan.repaidAmount += update.$inc.repaidAmount;
        loan.reservedRepayment += update.$inc.reservedRepayment;
        return loan;
      },
    ),
    updateOne: vi.fn(
      async (
        _filter: unknown,
        update: {
          $set?: { status?: string };
          $inc?: { reservedRepayment: number };
        },
      ) => {
        if (update.$set?.status) loan.status = update.$set.status;
        if (update.$inc)
          loan.reservedRepayment += update.$inc.reservedRepayment;
        return { modifiedCount: 1 };
      },
    ),
  };
  const db = {
    collection: vi.fn(
      (name: string) => ({ transactions, contributions, loans })[name],
    ),
  };
  const database = {
    db: vi.fn(async () => db),
    atomic: vi.fn(
      async (work: (db: unknown, session: object) => Promise<unknown>) =>
        work(db, {}),
    ),
  };
  const response = {
    reference: transaction.reference,
    amount: transaction.amount,
    currency: 'NGN',
    customer: { email: member.email },
    status: 'success',
    paid_at: '2026-11-21T12:00:00Z',
    id: 123,
  };
  const paystack = { request: vi.fn(async () => response) };
  const service = new FinanceService(
    database as unknown as DatabaseService,
    paystack as unknown as PaystackService,
    new ConfigService(),
  );
  return {
    service,
    transaction,
    transactions,
    contributions,
    contribution,
    loan,
    loans,
    database,
    paystack,
    response,
  };
}

describe('financial payment integrity', () => {
  it('credits a contribution only once across repeated verification and webhook delivery', async () => {
    const f = fixture();
    await f.service.verify(f.transaction.reference, member.localUserId);
    await f.service.verify(f.transaction.reference, member.localUserId);
    expect(f.transaction.status).toBe('successful');
    expect(f.contribution.status).toBe('successful');
    expect(f.contributions.updateOne).toHaveBeenCalledTimes(1);
    expect(f.database.atomic).toHaveBeenCalledTimes(2);
  });
  it.each(['amount', 'currency', 'email', 'reference'])(
    'does not credit a payment with mismatched %s',
    async (field) => {
      const f = fixture();
      if (field === 'amount') f.response.amount++;
      if (field === 'currency') f.response.currency = 'USD';
      if (field === 'email') f.response.customer.email = 'other@example.com';
      if (field === 'reference') f.response.reference += '-other';
      await expect(
        f.service.verify(f.transaction.reference, member.localUserId),
      ).rejects.toThrow('Payment details do not match');
      expect(f.transaction.status).toBe('pending');
      expect(f.transaction.reconciliation).toBe('needs_review');
      expect(f.contribution).toMatchObject({
        status: 'pending',
        reconciliation: 'needs_review',
      });
    },
  );
  it('keeps pending and abandoned checkouts out of balances', async () => {
    const f = fixture();
    for (const state of ['pending', 'abandoned', 'ongoing']) {
      f.response.status = state;
      await f.service.verify(f.transaction.reference, member.localUserId);
    }
    expect(f.transaction.status).toBe('pending');
    expect(f.database.atomic).not.toHaveBeenCalled();
  });
  it('applies a repayment once and closes a fully repaid loan', async () => {
    const f = fixture('loan_repayment');
    await f.service.verify(f.transaction.reference, member.localUserId);
    await f.service.verify(f.transaction.reference, member.localUserId);
    expect(f.loan).toMatchObject({
      repaidAmount: 10000,
      reservedRepayment: 0,
      status: 'repaid',
    });
    expect(f.loans.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
  it('releases a failed repayment reservation exactly once', async () => {
    const f = fixture('loan_repayment');
    f.response.status = 'failed';
    await f.service.verify(f.transaction.reference, member.localUserId);
    await f.service.verify(f.transaction.reference, member.localUserId);
    expect(f.loan.reservedRepayment).toBe(0);
    expect(f.loan.repaidAmount).toBe(0);
    expect(f.loans.updateOne).toHaveBeenCalledTimes(1);
  });
  it('rejects another member’s payment before contacting Paystack', async () => {
    const f = fixture();
    await expect(
      f.service.verify(f.transaction.reference, 'another-member'),
    ).rejects.toThrow('Payment not found');
    expect(f.paystack.request).not.toHaveBeenCalled();
  });
  it('does not mutate a previously successful payment on a later failed provider result', async () => {
    const f = fixture();
    await f.service.verify(f.transaction.reference);
    f.response.status = 'failed';
    await f.service.verify(f.transaction.reference);
    expect(f.transaction.status).toBe('successful');
    expect(f.contribution.status).toBe('successful');
  });
  it('blocks suspended members and outdated consent', () => {
    const f = fixture();
    expect(() =>
      f.service.active({ ...member, membershipStatus: 'suspended' }),
    ).toThrow();
    expect(() =>
      f.service.active({ ...member, termsVersion: 'old' }),
    ).toThrow();
  });
  it('rejects malformed references and missing idempotency keys', () => {
    expect(() => paymentKey()).toThrow();
    expect(() => paymentKey('short')).toThrow();
    expect(() => objectId('$ne')).toThrow();
    expect(paymentKey('a-valid-payment-key')).toBe('a-valid-payment-key');
  });
  it('uses exact kobo and clamps monthly due dates without month-end drift', () => {
    const schedule = repaymentSchedule(
      10001,
      3,
      new Date('2027-01-31T12:00:00Z'),
    );
    expect(schedule.map((row) => row.dueAt.toISOString().slice(0, 10))).toEqual(
      ['2027-02-28', '2027-03-31', '2027-04-30'],
    );
    expect(schedule.reduce((sum, row) => sum + row.amount, 0)).toBe(10001);
  });
  it('fails closed until pricing and a public loan terms URL are configured', () => {
    expect(fixture().service.policy().enabled).toBe(false);
  });
});

describe('Paystack webhook authentication', () => {
  const key = 'sk_test_example';
  const service = new PaystackService(
    new ConfigService({ PAYSTACK_SECRET_KEY: key }),
  );
  const raw = Buffer.from('{"event":"charge.success"}');
  it('accepts the SHA-512 signature over the exact raw body', () => {
    const signature = createHmac('sha512', key).update(raw).digest('hex');
    expect(() => service.verifySignature(raw, signature)).not.toThrow();
    expect(() =>
      service.verifySignature(Buffer.from('{}'), signature),
    ).toThrow();
  });
  it.each([undefined, '', 'bad-signature', 'a'.repeat(128)])(
    'rejects missing or forged signatures',
    (signature) => {
      expect(() => service.verifySignature(raw, signature)).toThrow();
    },
  );
});
