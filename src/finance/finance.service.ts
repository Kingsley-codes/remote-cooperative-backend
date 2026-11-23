import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectId, type Filter, type Document } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { recordId } from './record-id.js';
import type {
  FinancePolicyDto,
  PoolValuationDto,
  ReportDto,
  MembershipDto,
} from './finance.dto.js';
import { PaystackService } from './paystack.service.js';
import type {
  Contribution,
  Loan,
  MemberIdentity,
  Transaction,
} from './finance.model.js';
import type {
  ContributionDto,
  DecisionDto,
  EligibilityDto,
  LoanDto,
} from './finance.dto.js';

export function objectId(value: string) {
  if (!/^[a-f0-9]{24}$/i.test(value))
    throw new BadRequestException('Invalid record reference');
  return new ObjectId(value);
}
export function paymentKey(value?: string) {
  if (!value || !/^[a-zA-Z0-9_-]{16,80}$/.test(value))
    throw new BadRequestException('A valid Idempotency-Key is required');
  return value;
}
export function repaymentSchedule(amount: number, months: number, start: Date) {
  // Anchor every installment to the original day; clamp month ends.
  return Array.from({ length: months }, (_, index) => {
    const dueAt = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index + 2, 0),
    );
    dueAt.setUTCDate(Math.min(start.getUTCDate(), dueAt.getUTCDate()));
    return {
      dueAt,
      amount: Math.floor(amount / months) + (index < amount % months ? 1 : 0),
    };
  });
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly config: ConfigService,
  ) {}

  active(user: MemberIdentity) {
    if (
      user.membershipStatus !== 'active' ||
      user.termsVersion !== user.currentTermsVersion
    )
      throw new ForbiddenException(
        'An active membership and current accepted terms are required.',
      );
  }

  async policy() {
    const saved = await (
      await this.database.db()
    )
      .collection('financeSettings')
      .findOne({ key: 'loanPolicy' });
    if (saved)
      return {
        enabled: true,
        flatFeeBps: saved.flatFeeBps as number,
        maxMonths: saved.maxMonths as number,
        termsVersion: saved.termsVersion as string,
      };
    const rate = this.config.get<string>('LOAN_FLAT_FEE_BPS') ?? '';
    const version = this.config.get<string>('LOAN_TERMS_VERSION') ?? '';
    return {
      enabled: rate !== '' && version !== '',
      flatFeeBps: Number(rate),
      maxMonths: Number(this.config.get('LOAN_MAX_MONTHS') ?? 12),
      termsVersion: version,
    };
  }

  async eligibility(memberId: string) {
    const db = await this.database.db();
    const snapshot = await db
      .collection('loanEligibility')
      .findOne(
        { memberId, expiresAt: { $gt: new Date() } },
        { projection: { _id: 0, actor: 0 } },
      );
    return { policy: await this.policy(), snapshot };
  }

  async savePolicy(dto: FinancePolicyDto, actor: string) {
    return this.database.atomic(async (db, session) => {
      const before = (await db
        .collection('financeSettings')
        .findOne({ key: 'loanPolicy' }, { session })) ?? {
        flatFeeBps: Number(this.config.get('LOAN_FLAT_FEE_BPS') ?? 0),
        maxMonths: Number(this.config.get('LOAN_MAX_MONTHS') ?? 12),
        termsVersion: this.config.get('LOAN_TERMS_VERSION') ?? '',
      };
      if (
        before.termsVersion &&
        (before.flatFeeBps !== dto.flatFeeBps ||
          before.maxMonths !== dto.maxMonths) &&
        before.termsVersion === dto.termsVersion
      )
        throw new BadRequestException(
          'Use a new terms version when changing pricing or duration.',
        );
      await db
        .collection('financeSettings')
        .updateOne(
          { key: 'loanPolicy' },
          { $set: { ...dto, updatedAt: new Date() } },
          { upsert: true, session },
        );
      await db
        .collection('auditLogs')
        .insertOne(
          { actor, action: 'loan.policy', before, after: dto, at: new Date() },
          { session },
        );
      return { saved: true };
    });
  }

  async saveValuation(dto: PoolValuationDto, actor: string) {
    const valuedAt = new Date(
      Math.min(
        Date.now(),
        new Date(`${dto.valuedAt}T23:59:59.999+01:00`).getTime(),
      ),
    );
    if (
      !Number.isFinite(valuedAt.getTime()) ||
      dto.valuedAt > new Date(Date.now() + 3600000).toISOString().slice(0, 10)
    )
      throw new BadRequestException(
        'Choose a valid valuation date up to today.',
      );
    return this.database.atomic(async (db, session) => {
      const holdings = await db
        .collection('contributions')
        .aggregate(
          [
            {
              $match: {
                type: 'long_term',
                status: 'successful',
                paidAt: { $lte: valuedAt },
              },
            },
            { $group: { _id: '$memberId', amount: { $sum: '$amount' } } },
          ],
          { session },
        )
        .toArray();
      const capital = holdings.reduce((sum, item) => sum + item.amount, 0);
      if (!capital)
        throw new BadRequestException(
          'No confirmed long-term capital exists for this date.',
        );
      // Freeze the calculation basis so later confirmations cannot change an approved valuation.
      const allocations = holdings.map((item) => ({
        memberId: item._id,
        capital: item.amount,
        share: Number(
          (BigInt(item.amount) * BigInt(dto.assetValue)) / BigInt(capital),
        ),
      }));
      const valuation = {
        ...dto,
        valuedAt,
        capital,
        allocations,
        allocationMethod: 'capital_proportion',
        status: 'approved',
        actor,
        createdAt: new Date(),
      };
      await db.collection('poolValuations').insertOne(valuation, { session });
      await db
        .collection('auditLogs')
        .insertOne(
          { actor, action: 'pool.valuation', after: valuation, at: new Date() },
          { session },
        );
      return { saved: true };
    });
  }

  async detail(
    kind: 'contributions' | 'transactions' | 'loans',
    id: string,
    memberId?: string,
  ): Promise<Document> {
    const db = await this.database.db();
    const record = await db
      .collection(kind)
      .findOne(
        { id, ...(memberId ? { memberId } : {}) },
        { projection: { email: 0, idempotencyKey: 0, recipientCode: 0 } },
      );
    if (!record) throw new NotFoundException('Record not found');
    const user = await db
      .collection('users')
      .findOne(
        { _id: objectId(record.memberId) },
        { projection: { firstName: 1, lastName: 1, email: 1, phone: 1 } },
      );
    const linked =
      kind === 'transactions' && (record.contributionid || record.loanid)
        ? await this.detail(
            record.contributionid ? 'contributions' : 'loans',
            record.contributionid ?? record.loanid,
            record.memberId,
          )
        : null;
    const reports =
      kind === 'transactions' && !memberId
        ? await db
            .collection('transactionReports')
            .find(
              { transactionid: id },
              { projection: { reason: 1, status: 1, createdAt: 1 } },
            )
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray()
        : [];
    return {
      ...record,
      reports,
      member: user
        ? {
            name: `${user.firstName} ${user.lastName}`.trim(),
            email: user.email,
            phone: user.phone,
          }
        : null,
      linked,
    };
  }

  async report(id: string, dto: ReportDto, memberId?: string, actor?: string) {
    const record = await this.detail('transactions', id, memberId);
    await (
      await this.database.db()
    )
      .collection('transactionReports')
      .insertOne({
        transactionid: record.id,
        memberId: record.memberId,
        reason: dto.reason,
        actor: actor ?? memberId,
        status: 'open',
        createdAt: new Date(),
      });
    return { reported: true };
  }

  async members(query: Record<string, string>) {
    const db = await this.database.db();
    if (Object.values(query).some((value) => typeof value !== 'string'))
      throw new BadRequestException(
        'Filters must contain single string values',
      );
    const filter: Record<string, unknown> = {};
    if (query.status) {
      if (!['active', 'suspended', 'pending'].includes(query.status))
        throw new BadRequestException('Invalid membership status');
      filter.membershipStatus = query.status;
    }
    if (query.search) {
      if (query.search.length > 100)
        throw new BadRequestException('Search is too long');
      const search = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = ['firstName', 'lastName', 'email'].map((key) => ({
        [key]: { $regex: search, $options: 'i' },
      }));
    }
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      for (const key of ['from', 'to'])
        if (query[key]) {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(query[key]) ||
            !Number.isFinite(Date.parse(query[key]))
          )
            throw new BadRequestException('Invalid date');
          range[key === 'from' ? '$gte' : '$lt'] = new Date(
            new Date(`${query[key]}T00:00:00+01:00`).getTime() +
              (key === 'to' ? 86400000 : 0),
          );
        }
      filter.createdAt = range;
    }
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
    if (!Number.isInteger(page)) throw new BadRequestException('Invalid page');
    const collection = db.collection('users');
    const [items, total] = await Promise.all([
      collection
        .find(filter, {
          projection: {
            firstName: 1,
            lastName: 1,
            email: 1,
            phone: 1,
            membershipStatus: 1,
            createdAt: 1,
            termsVersion: 1,
          },
        })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 20)
        .limit(20)
        .toArray(),
      collection.countDocuments(filter),
    ]);
    return { items, total, page, pageSize: 20 };
  }

  async membership(id: string, dto: MembershipDto, actor: string) {
    return this.database.atomic(async (db, session) => {
      const user = await db
        .collection('users')
        .findOne({ _id: objectId(id) }, { session });
      if (!user) throw new NotFoundException('Member not found');
      if (dto.status === 'active' && !user.termsAcceptedAt)
        throw new BadRequestException(
          'The member must accept cooperative terms before activation.',
        );
      await db
        .collection('users')
        .updateOne(
          { _id: user._id },
          { $set: { membershipStatus: dto.status, updatedAt: new Date() } },
          { session },
        );
      await db
        .collection('auditLogs')
        .insertOne(
          {
            actor,
            action: 'membership.status',
            targetId: id,
            before: user.membershipStatus,
            after: dto.status,
            reason: dto.reason,
            at: new Date(),
          },
          { session },
        );
      return { saved: true };
    });
  }

  async list(
    kind: 'contributions' | 'transactions' | 'loans',
    query: Record<string, string>,
    memberId?: string,
  ) {
    if (Object.values(query).some((value) => typeof value !== 'string'))
      throw new BadRequestException(
        'Filters must contain single string values',
      );
    const db = await this.database.db();
    const filter: Filter<Transaction> = {};
    if (memberId) filter.memberId = memberId;
    else if (query.memberId) filter.memberId = query.memberId;
    for (const key of [
      'status',
      'type',
      'category',
      'reconciliation',
    ] as const) {
      if (query[key]) (filter as Record<string, unknown>)[key] = query[key];
    }
    if (query.search) {
      if (query.search.length > 100)
        throw new BadRequestException('Search is too long');
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = memberId
        ? []
        : await db
            .collection('users')
            .find({
              $or: ['firstName', 'lastName', 'email'].map((key) => ({
                [key]: { $regex: escaped, $options: 'i' },
              })),
            })
            .project({ _id: 1 })
            .toArray();
      filter.$or = [
        { id: { $regex: escaped, $options: 'i' } },
        { reference: { $regex: escaped, $options: 'i' } },
        ...(!memberId
          ? [
              {
                memberId: {
                  $in: matches.map((user) => user._id.toHexString()),
                },
              },
            ]
          : []),
      ];
    }
    if (query.from || query.to) {
      const range: { $gte?: Date; $lt?: Date } = {};
      for (const key of ['from', 'to'] as const)
        if (query[key]) {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(query[key]) ||
            !Number.isFinite(Date.parse(query[key]))
          )
            throw new BadRequestException('Invalid date');
          const date = new Date(`${query[key]}T00:00:00+01:00`);
          if (key === 'from') range.$gte = date;
          else range.$lt = new Date(date.getTime() + 86400000);
        }
      filter.createdAt = range;
    }
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
    if (!Number.isInteger(page)) throw new BadRequestException('Invalid page');
    const collection = db.collection<Transaction>(kind);
    const [items, total, totals] = await Promise.all([
      collection
        .find(filter, {
          projection: { email: 0, idempotencyKey: 0, recipientCode: 0 },
        })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 20)
        .limit(20)
        .toArray(),
      collection.countDocuments(filter),
      collection
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: '$status',
              amount: { $sum: '$amount' },
              outstanding: {
                $sum: { $subtract: ['$totalDue', '$repaidAmount'] },
              },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    ]);
    const users = await db
      .collection('users')
      .find({ _id: { $in: items.map((item) => objectId(item.memberId)) } })
      .project({ firstName: 1, lastName: 1, email: 1, phone: 1 })
      .toArray();
    const resolved = items.map((item) => {
      const user = users.find(
        (user) => user._id.toHexString() === item.memberId,
      );
      return {
        ...item,
        member: user
          ? {
              name: `${user.firstName} ${user.lastName}`.trim(),
              email: user.email,
              phone: user.phone,
            }
          : null,
      };
    });
    return {
      items: resolved,
      total,
      page,
      pageSize: 20,
      totals,
      asOf: new Date(),
    };
  }

  async summary(memberId?: string) {
    const db = await this.database.db();
    const match = memberId ? { memberId } : {};
    const contributions = await db
      .collection<Contribution>('contributions')
      .aggregate([
        { $match: { ...match, status: 'successful' } },
        {
          $group: {
            _id: '$type',
            amount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();
    const withdrawals = await db
      .collection<Transaction>('transactions')
      .aggregate([
        {
          $match: {
            ...match,
            category: 'withdrawal',
            status: { $in: ['pending', 'successful'] },
          },
        },
        { $group: { _id: '$status', amount: { $sum: '$amount' } } },
      ])
      .toArray();
    const value = (type: string) =>
      contributions.find((row) => row._id === type)?.amount ?? 0;
    const withdrawn = (status: string) =>
      withdrawals.find((row) => row._id === status)?.amount ?? 0;
    const pool = await db
      .collection('contributions')
      .aggregate([
        { $match: { type: 'long_term', status: 'successful' } },
        { $group: { _id: null, amount: { $sum: '$amount' } } },
      ])
      .next();
    const valuation = await db.collection('poolValuations').findOne(
      { status: 'approved' },
      {
        sort: { valuedAt: -1, createdAt: -1 },
        projection: {
          _id: 0,
          assetValue: 1,
          valuedAt: 1,
          note: 1,
          capital: 1,
          allocationMethod: 1,
          ...(memberId ? { allocations: { $elemMatch: { memberId } } } : {}),
        },
      },
    );
    const activeLoans = await db
      .collection<Loan>('loans')
      .aggregate([
        { $match: { ...match, status: 'active' } },
        {
          $group: {
            _id: null,
            outstanding: {
              $sum: { $subtract: ['$totalDue', '$repaidAmount'] },
            },
            repaid: { $sum: '$repaidAmount' },
          },
        },
      ])
      .next();
    const allocation = valuation?.allocations?.[0];
    const estimatedShare =
      memberId && valuation?.capital ? (allocation?.share ?? 0) : null;
    const { allocations: _allocations, ...publicValuation } = valuation ?? {};
    const operations = memberId ? undefined : {
      pendingLoans: await db.collection('loans').countDocuments({ status: 'pending_review' }),
      paymentExceptions: await db.collection('transactions').countDocuments({ reconciliation: 'needs_review' }),
    };
    return {
      operations,
      estimatedShare,
      allocatedGain:
        estimatedShare === null
          ? null
          : estimatedShare - (allocation?.capital ?? 0),
      longTerm: value('long_term'),
      shortTerm: value('short_term'),
      available:
        value('short_term') - withdrawn('pending') - withdrawn('successful'),
      pendingWithdrawals: withdrawn('pending'),
      completedWithdrawals: withdrawn('successful'),
      loanOutstanding: activeLoans?.outstanding ?? 0,
      loanRepaid: activeLoans?.repaid ?? 0,
      poolCapital: pool?.amount ?? 0,
      valuation: valuation ? publicValuation : null,
      asOf: new Date(),
    };
  }

  async contribute(
    user: MemberIdentity,
    dto: ContributionDto,
    key: string,
  ): Promise<{ reference: string; status: string; checkoutUrl?: string }> {
    this.active(user);
    const db = await this.database.db();
    const previous = await db
      .collection<Transaction>('transactions')
      .findOne({ memberId: user.localUserId, idempotencyKey: key });
    if (previous) {
      if (previous.amount !== dto.amount || previous.category !== dto.type)
        throw new ConflictException(
          'This request key was already used for another payment',
        );
      return this.initialize(previous);
    }
    const contribution: Contribution = {
      _id: new ObjectId(),
      id: recordId('CON'),
      memberId: user.localUserId,
      type: dto.type,
      amount: dto.amount,
      currency: 'NGN',
      reference: `coop_${randomUUID()}`,
      status: 'pending',
      reconciliation: 'unmatched',
      createdAt: new Date(),
    };
    const transaction: Transaction = {
      _id: new ObjectId(),
      id: recordId('TRX'),
      memberId: user.localUserId,
      email: user.email,
      category: dto.type,
      amount: dto.amount,
      currency: 'NGN',
      reference: contribution.reference,
      contributionid: contribution.id,
      idempotencyKey: key,
      status: 'pending',
      reconciliation: 'unmatched',
      createdAt: contribution.createdAt,
    };
    try {
      await this.database.atomic(async (db, session) => {
        await db
          .collection<Contribution>('contributions')
          .insertOne(contribution, { session });
        await db
          .collection<Transaction>('transactions')
          .insertOne(transaction, { session });
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        return this.contribute(user, dto, key);
      throw error;
    }
    return this.initialize(transaction);
  }

  private async initialize(transaction: Transaction) {
    if (transaction.status !== 'pending')
      return { reference: transaction.reference, status: transaction.status };
    // A timeout is ambiguous. Preserve the reference for verification; never
    // create a replacement payment or credit money on an initialize response.
    const data = await this.paystack.request('/transaction/initialize', {
      email: transaction.email,
      amount: transaction.amount,
      currency: 'NGN',
      reference: transaction.reference,
      callback_url: `${this.config.get<string>('APP_ORIGIN')}/dashboard/transactions`,
      metadata: {
        category: transaction.category,
        recordId: transaction.contributionid ?? transaction.loanid,
      },
    });
    const url = new URL(data.authorization_url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'checkout.paystack.com' ||
      data.reference !== transaction.reference
    )
      throw new ServiceUnavailableException('Invalid checkout response');
    return {
      reference: transaction.reference,
      status: 'pending',
      checkoutUrl: url.href,
    };
  }

  async verify(reference: string, memberId?: string) {
    if (!/^coop_[a-f0-9-]{36}$/.test(reference))
      throw new BadRequestException('Invalid payment reference');
    const db = await this.database.db();
    const transaction = await db
      .collection<Transaction>('transactions')
      .findOne({ reference, ...(memberId ? { memberId } : {}) });
    if (!transaction) throw new NotFoundException('Payment not found');
    if (
      transaction.category === 'loan_disbursement' ||
      transaction.category === 'withdrawal'
    )
      throw new BadRequestException('This is a payout reference');
    const data = await this.paystack.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    if (
      data.reference !== reference ||
      data.amount !== transaction.amount ||
      data.currency !== 'NGN' ||
      data.customer?.email?.toLowerCase() !== transaction.email.toLowerCase()
    ) {
      await this.markReview(transaction);
      throw new ConflictException(
        'Payment details do not match. Contact support with your reference.',
      );
    }
    if (data.status === 'success' && transaction.status === 'failed') {
      await this.markReview(transaction);
    } else if (data.status === 'success')
      await this.settle(transaction, String(data.id), data.paid_at);
    else if (data.status === 'failed') await this.fail(transaction);
    else if (data.status === 'reversed') {
      await this.markReview(transaction);
    }
    return db
      .collection<Transaction>('transactions')
      .findOne(
        { _id: transaction._id },
        { projection: { email: 0, checkoutUrl: 0, idempotencyKey: 0 } },
      );
  }

  private async markReview(transaction: Transaction) {
    await this.database.atomic(async (db, session) => {
      await db
        .collection<Transaction>('transactions')
        .updateOne(
          { _id: transaction._id },
          { $set: { reconciliation: 'needs_review' } },
          { session },
        );
      if (
        transaction.category === 'long_term' ||
        transaction.category === 'short_term'
      ) {
        await db
          .collection<Contribution>('contributions')
          .updateOne(
            { reference: transaction.reference },
            { $set: { reconciliation: 'needs_review' } },
            { session },
          );
      }
    });
  }

  private async settle(
    transaction: Transaction,
    providerId: string,
    paidAt: string,
  ) {
    await this.database.atomic(async (db, session) => {
      const changed = await db
        .collection<Transaction>('transactions')
        .updateOne(
          { _id: transaction._id, status: 'pending' },
          {
            $set: {
              status: 'successful',
              reconciliation: 'matched',
              providerId,
              paidAt: new Date(paidAt),
            },
          },
          { session },
        );
      if (!changed.modifiedCount) return;
      if (transaction.category === 'loan_repayment') {
        const loan = await db.collection<Loan>('loans').findOneAndUpdate(
          { id: transaction.loanid },
          {
            $inc: {
              repaidAmount: transaction.amount,
              reservedRepayment: -transaction.amount,
            },
          },
          { session, returnDocument: 'after' },
        );
        if (!loan) throw new ConflictException('Loan not found');
        if (loan.repaidAmount === loan.totalDue)
          await db
            .collection<Loan>('loans')
            .updateOne(
              { _id: loan._id },
              { $set: { status: 'repaid' } },
              { session },
            );
      } else {
        await db.collection<Contribution>('contributions').updateOne(
          { reference: transaction.reference },
          {
            $set: {
              status: 'successful',
              reconciliation: 'matched',
              paidAt: new Date(paidAt),
            },
          },
          { session },
        );
      }
    });
  }

  private async fail(transaction: Transaction) {
    await this.database.atomic(async (db, session) => {
      const changed = await db
        .collection<Transaction>('transactions')
        .updateOne(
          { _id: transaction._id, status: 'pending' },
          { $set: { status: 'failed', reconciliation: 'matched' } },
          { session },
        );
      if (!changed.modifiedCount) return;
      if (transaction.category === 'loan_repayment')
        await db
          .collection<Loan>('loans')
          .updateOne(
            { id: transaction.loanid },
            { $inc: { reservedRepayment: -transaction.amount } },
            { session },
          );
      else
        await db
          .collection<Contribution>('contributions')
          .updateOne(
            { reference: transaction.reference },
            { $set: { status: 'failed', reconciliation: 'matched' } },
            { session },
          );
    });
  }

  async webhook(
    raw: Buffer | undefined,
    signature: string | undefined,
    event: { event?: string; data?: { reference?: string } },
  ) {
    this.paystack.verifySignature(raw, signature);
    if (
      event.event === 'charge.success' &&
      event.data?.reference?.startsWith('coop_')
    )
      await this.verify(event.data.reference);
    return { received: true };
  }

  async apply(user: MemberIdentity, dto: LoanDto) {
    this.active(user);
    const { policy, snapshot } = await this.eligibility(user.localUserId);
    if (!policy.enabled || !snapshot)
      throw new ForbiddenException(
        'Verified investment eligibility and configured loan pricing and terms version are required.',
      );
    if (
      !dto.consent ||
      dto.termsVersion !== policy.termsVersion ||
      dto.amount > snapshot.maximum ||
      dto.months > policy.maxMonths
    )
      throw new BadRequestException(
        'Review the current loan limits and terms.',
      );
    const fee = Math.ceil((dto.amount * policy.flatFeeBps) / 10000);
    const loan: Loan = {
      _id: new ObjectId(),
      id: recordId('LOA'),
      memberId: user.localUserId,
      amount: dto.amount,
      fee,
      totalDue: dto.amount + fee,
      repaidAmount: 0,
      reservedRepayment: 0,
      months: dto.months,
      purpose: dto.purpose,
      status: 'pending_review',
      termsVersion: policy.termsVersion,
      consentAt: new Date(),
      eligibility: {
        investmentValue: snapshot.investmentValue,
        maximum: snapshot.maximum,
        source: snapshot.source,
        verifiedAt: snapshot.verifiedAt,
        expiresAt: snapshot.expiresAt,
      },
      createdAt: new Date(),
    };
    await this.database.atomic(async (db, session) => {
      // Serialize applications per member without a new locking subsystem.
      await db
        .collection('users')
        .updateOne(
          { _id: objectId(user.localUserId) },
          { $inc: { financeVersion: 1 } },
          { session },
        );
      if (
        await db.collection<Loan>('loans').findOne(
          {
            memberId: user.localUserId,
            status: { $nin: ['rejected', 'repaid'] },
          },
          { session },
        )
      )
        throw new ConflictException(
          'You already have an open loan application or loan.',
        );
      await db.collection<Loan>('loans').insertOne(loan, { session });
    });
    return loan;
  }

  async decide(id: string, dto: DecisionDto, actor: string) {
    return this.database.atomic(async (db, session) => {
      const decision = { actor, reason: dto.reason, at: new Date() };
      const loan = await db.collection<Loan>('loans').findOneAndUpdate(
        { _id: objectId(id), status: 'pending_review' },
        {
          $set: {
            status: dto.decision === 'approve' ? 'approved' : 'rejected',
            decision,
          },
        },
        { session, returnDocument: 'after' },
      );
      if (!loan)
        throw new ConflictException(
          'This application has already been reviewed.',
        );
      await db
        .collection('auditLogs')
        .insertOne(
          { action: `loan.${dto.decision}`, targetId: id, ...decision },
          { session },
        );
      return loan;
    });
  }

  async setEligibility(dto: EligibilityDto, actor: string) {
    if (dto.maximum > dto.investmentValue)
      throw new BadRequestException(
        'Limit cannot exceed verified investment value',
      );
    return this.database.atomic(async (db, session) => {
      if (
        !(await db
          .collection('users')
          .findOne(
            { _id: objectId(dto.memberId), membershipStatus: 'active' },
            { session },
          ))
      )
        throw new NotFoundException('Active member not found');
      const evidence = {
        memberId: dto.memberId,
        investmentValue: dto.investmentValue,
        maximum: dto.maximum,
        source: dto.source,
      };
      const snapshot = {
        ...evidence,
        actor,
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };
      await db
        .collection('loanEligibility')
        .updateOne(
          { memberId: dto.memberId },
          { $set: snapshot },
          { upsert: true, session },
        );
      await db.collection('auditLogs').insertOne(
        {
          actor,
          action: 'loan.verify_eligibility',
          at: new Date(),
          ...evidence,
        },
        { session },
      );
      return snapshot;
    });
  }

  async repay(user: MemberIdentity, id: string, amount: number, key: string) {
    this.active(user);
    const db = await this.database.db();
    const repaymentLoan = await db
      .collection<Loan>('loans')
      .findOne({ _id: objectId(id), memberId: user.localUserId });
    if (!repaymentLoan) throw new NotFoundException('Loan not found');
    const previous = await db
      .collection<Transaction>('transactions')
      .findOne({ memberId: user.localUserId, idempotencyKey: key });
    if (previous) {
      if (
        previous.amount !== amount ||
        previous.loanid !== repaymentLoan.id ||
        previous.category !== 'loan_repayment'
      )
        throw new ConflictException('Request key already used');
      return this.initialize(previous);
    }
    const transaction: Transaction = {
      _id: new ObjectId(),
      id: recordId('TRX'),
      memberId: user.localUserId,
      email: user.email,
      category: 'loan_repayment',
      amount,
      currency: 'NGN',
      reference: `coop_${randomUUID()}`,
      loanid: repaymentLoan.id,
      idempotencyKey: key,
      status: 'pending',
      reconciliation: 'unmatched',
      createdAt: new Date(),
    };
    await this.database.atomic(async (db, session) => {
      const loan = await db.collection<Loan>('loans').findOneAndUpdate(
        {
          _id: objectId(id),
          memberId: user.localUserId,
          status: 'active',
          $expr: {
            $gte: [
              {
                $subtract: [
                  '$totalDue',
                  { $add: ['$repaidAmount', '$reservedRepayment'] },
                ],
              },
              amount,
            ],
          },
        },
        { $inc: { reservedRepayment: amount } },
        { session },
      );
      if (!loan)
        throw new ConflictException(
          'Repayment exceeds the unreserved outstanding balance, or the loan is not active.',
        );
      await db
        .collection<Transaction>('transactions')
        .insertOne(transaction, { session });
    });
    return this.initialize(transaction);
  }
}
