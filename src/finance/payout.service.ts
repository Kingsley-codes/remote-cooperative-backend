import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceService,
  objectId,
  repaymentSchedule,
} from './finance.service.js';
import { PaystackService } from './paystack.service.js';
import type { BankAccountDto } from './finance.dto.js';
import type { Loan, MemberIdentity, Transaction } from './finance.model.js';

@Injectable()
export class PayoutService {
  constructor(
    private readonly database: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly finance: FinanceService,
    private readonly config: ConfigService,
  ) {}
  private enabled() {
    if (this.config.get<string>('PAYSTACK_TRANSFERS_ENABLED') !== 'true')
      throw new ServiceUnavailableException('Payouts are not enabled yet.');
  }
  async banks() {
    return this.paystack.request(
      '/bank?country=nigeria&currency=NGN&perPage=100',
    );
  }
  async destination(memberId: string) {
    const user = await (
      await this.database.db()
    )
      .collection('users')
      .findOne({ _id: objectId(memberId) });
    return {
      enabled: this.config.get<string>('PAYSTACK_TRANSFERS_ENABLED') === 'true',
      destination: user?.payout
        ? {
            name: user.payout.name,
            last4: user.payout.last4,
            bankCode: user.payout.bankCode,
          }
        : null,
      fee: 0,
      timing:
        'Usually within one business day; completion depends on provider confirmation.',
    };
  }
  async saveDestination(user: MemberIdentity, dto: BankAccountDto) {
    this.finance.active(user);
    this.enabled();
    const account = await this.paystack.request(
      `/bank/resolve?account_number=${dto.accountNumber}&bank_code=${dto.bankCode}`,
    );
    if (account.account_number !== dto.accountNumber || !account.account_name)
      throw new BadRequestException('Bank account could not be verified');
    // Match the verified account to the cooperative member; do not permit an
    // arbitrary third-party destination for a financial account.
    const db = await this.database.db();
    const local = await db
      .collection('users')
      .findOne({ _id: objectId(user.localUserId) });
    const normalized = account.account_name
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/);
    if (
      ![local?.firstName, local?.lastName].every(
        (name) =>
          typeof name === 'string' && normalized.includes(name.toLowerCase()),
      )
    )
      throw new BadRequestException(
        'The bank account name must match your membership name. Contact support if your legal name has changed.',
      );
    const recipient = await this.paystack.request('/transferrecipient', {
      type: 'nuban',
      name: account.account_name,
      account_number: dto.accountNumber,
      bank_code: dto.bankCode,
      currency: 'NGN',
    });
    await db.collection('users').updateOne(
      { _id: objectId(user.localUserId) },
      {
        $set: {
          payout: {
            recipientCode: recipient.recipient_code,
            name: account.account_name,
            last4: dto.accountNumber.slice(-4),
            bankCode: dto.bankCode,
            verifiedAt: new Date(),
          },
        },
      },
    );
    return this.destination(user.localUserId);
  }
  async withdraw(user: MemberIdentity, amount: number, key: string) {
    this.finance.active(user);
    this.enabled();
    const db = await this.database.db();
    const previous = await db
      .collection<Transaction>('transactions')
      .findOne({ memberId: user.localUserId, idempotencyKey: key });
    if (previous) {
      if (previous.category !== 'withdrawal' || previous.amount !== amount)
        throw new ConflictException('Request key already used');
      return this.verify(previous.reference, user.localUserId);
    }
    const transaction = await this.database.atomic(async (db, session) => {
      const local = await db
        .collection('users')
        .findOneAndUpdate(
          { _id: objectId(user.localUserId) },
          { $inc: { financeVersion: 1 } },
          { session, returnDocument: 'after' },
        );
      if (!local?.payout)
        throw new BadRequestException('Add a verified payout account first');
      const summary = await db
        .collection('contributions')
        .aggregate(
          [
            {
              $match: {
                memberId: user.localUserId,
                type: 'short_term',
                status: 'successful',
              },
            },
            { $group: { _id: null, amount: { $sum: '$amount' } } },
          ],
          { session },
        )
        .next();
      const reserved = await db
        .collection('transactions')
        .aggregate(
          [
            {
              $match: {
                memberId: user.localUserId,
                category: 'withdrawal',
                status: { $in: ['pending', 'successful'] },
              },
            },
            { $group: { _id: null, amount: { $sum: '$amount' } } },
          ],
          { session },
        )
        .next();
      if (amount > (summary?.amount ?? 0) - (reserved?.amount ?? 0))
        throw new ConflictException(
          'Amount exceeds available short-term savings',
        );
      const record: Transaction = {
        _id: new ObjectId(),
        memberId: user.localUserId,
        email: user.email,
        category: 'withdrawal',
        direction: 'out',
        amount,
        currency: 'NGN',
        reference: `coop_${randomUUID()}`,
        linkedId: user.localUserId,
        idempotencyKey: key,
        status: 'pending',
        reconciliation: 'unmatched',
        recipientCode: local.payout.recipientCode,
        destination: `${local.payout.name} · •••• ${local.payout.last4}`,
        createdAt: new Date(),
      };
      await db
        .collection<Transaction>('transactions')
        .insertOne(record, { session });
      return record;
    });
    return this.send(transaction);
  }
  async disburse(id: string, actor: string) {
    this.enabled();
    const transaction = await this.database.atomic(async (db, session) => {
      const loan = await db
        .collection<Loan>('loans')
        .findOneAndUpdate(
          { _id: objectId(id), status: 'approved' },
          { $set: { status: 'disbursement_pending' } },
          { session, returnDocument: 'after' },
        );
      if (!loan)
        throw new ConflictException('Loan is not awaiting disbursement');
      const user = await db
        .collection('users')
        .findOne(
          { _id: objectId(loan.memberId), membershipStatus: 'active' },
          { session },
        );
      if (!user?.payout)
        throw new BadRequestException(
          'The member needs an active membership and verified payout account',
        );
      const record: Transaction = {
        _id: new ObjectId(),
        memberId: loan.memberId,
        email: user.email,
        category: 'loan_disbursement',
        direction: 'out',
        amount: loan.amount,
        currency: 'NGN',
        reference: `coop_${randomUUID()}`,
        linkedId: id,
        idempotencyKey: `disburse_${id}_${randomUUID()}`,
        status: 'pending',
        reconciliation: 'unmatched',
        recipientCode: user.payout.recipientCode,
        destination: `${user.payout.name} · •••• ${user.payout.last4}`,
        createdAt: new Date(),
      };
      await db
        .collection<Transaction>('transactions')
        .insertOne(record, { session });
      await db.collection('auditLogs').insertOne(
        {
          actor,
          action: 'loan.disburse',
          targetId: id,
          reference: record.reference,
          at: new Date(),
        },
        { session },
      );
      return record;
    });
    return this.send(transaction);
  }
  private async send(transaction: Transaction) {
    // Once persisted, all retries/reconciliation use the SAME provider reference.
    // Network errors keep funds reserved. A timeout never releases the balance.
    try {
      await this.paystack.request('/transfer', {
        source: 'balance',
        amount: transaction.amount,
        recipient: transaction.recipientCode,
        reference: transaction.reference,
        reason:
          transaction.category === 'withdrawal'
            ? 'Cooperative savings withdrawal'
            : 'Cooperative loan disbursement',
      });
    } catch {
      return {
        reference: transaction.reference,
        status: transaction.status,
        amount: transaction.amount,
        message:
          'Payout is pending reconciliation. Do not submit a replacement.',
      };
    }
    return this.verify(transaction.reference);
  }
  async retry(reference: string, actor: string, reason: string) {
    this.enabled();
    const db = await this.database.db();
    const transaction = await db
      .collection<Transaction>('transactions')
      .findOne({
        reference,
        category: { $in: ['withdrawal', 'loan_disbursement'] },
        status: 'pending',
      });
    if (!transaction)
      throw new ConflictException('Only pending payouts can be retried');
    await db.collection('auditLogs').insertOne({
      actor,
      action: 'payout.retry',
      reference,
      reason,
      at: new Date(),
    });
    // Paystack enforces uniqueness of transfer references. Reusing the persisted
    // reference cannot create a second transfer even after an ambiguous timeout.
    return this.send(transaction);
  }
  async verify(reference: string, memberId?: string) {
    const db = await this.database.db();
    const transaction = await db
      .collection<Transaction>('transactions')
      .findOne({
        reference,
        category: { $in: ['withdrawal', 'loan_disbursement'] },
        ...(memberId ? { memberId } : {}),
      });
    if (!transaction) throw new NotFoundException('Payout not found');
    const result = await this.paystack.request(
      `/transfer/verify/${encodeURIComponent(reference)}`,
    );
    if (
      result.amount !== transaction.amount ||
      result.currency !== 'NGN' ||
      result.reference !== reference ||
      result.recipient?.recipient_code !== transaction.recipientCode
    )
      throw new ConflictException(
        'Payout details do not match. Contact support.',
      );
    if (['success', 'failed', 'reversed'].includes(result.status)) {
      await this.database.atomic(async (db, session) => {
        if (
          transaction.status === 'successful' &&
          result.status === 'reversed'
        ) {
          // Keep the original entry intact; require an audited correction rather
          // than silently changing completed history or issuing another payout.
          await db
            .collection<Transaction>('transactions')
            .updateOne(
              { _id: transaction._id },
              { $set: { reconciliation: 'needs_review' } },
              { session },
            );
          return;
        }
        const successful = result.status === 'success';
        const changed = await db
          .collection<Transaction>('transactions')
          .updateOne(
            { _id: transaction._id, status: 'pending' },
            {
              $set: {
                status: successful ? 'successful' : 'failed',
                reconciliation: 'matched',
                providerId: result.transfer_code,
                ...(successful ? { paidAt: new Date() } : {}),
              },
            },
            { session },
          );
        if (
          changed.modifiedCount &&
          transaction.category === 'loan_disbursement'
        ) {
          const loan = await db
            .collection<Loan>('loans')
            .findOne({ _id: objectId(transaction.linkedId) }, { session });
          if (!loan) throw new ConflictException('Loan not found');
          await db.collection<Loan>('loans').updateOne(
            { _id: loan._id },
            {
              $set: successful
                ? {
                    status: 'active',
                    disbursedAt: new Date(),
                    schedule: repaymentSchedule(
                      loan.totalDue,
                      loan.months,
                      new Date(),
                    ),
                  }
                : { status: 'approved' },
            },
            { session },
          );
        }
      });
    }
    return db
      .collection<Transaction>('transactions')
      .findOne(
        { _id: transaction._id },
        { projection: { email: 0, recipientCode: 0, idempotencyKey: 0 } },
      );
  }
  async webhook(
    raw: Buffer | undefined,
    signature: string | undefined,
    event: { event?: string; data?: { reference?: string } },
  ) {
    this.paystack.verifySignature(raw, signature);
    if (
      event.event?.startsWith('transfer.') &&
      event.data?.reference?.startsWith('coop_')
    )
      await this.verify(event.data.reference);
    return { received: true };
  }
}
