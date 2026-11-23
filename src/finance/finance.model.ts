import type { ObjectId } from 'mongodb';

export type PaymentStatus = 'pending' | 'successful' | 'failed' | 'reversed';
export type ContributionType = 'long_term' | 'short_term';
export interface Contribution {
  _id: ObjectId;
  id: string;
  memberId: string;
  type: ContributionType;
  amount: number; // Integer kobo throughout the financial domain.
  currency: 'NGN';
  reference: string;
  status: PaymentStatus;
  reconciliation: 'unmatched' | 'matched' | 'needs_review';
  createdAt: Date;
  paidAt?: Date;
}
export interface Transaction {
  _id: ObjectId;
  id: string;
  memberId: string;
  email: string;
  category:
    ContributionType | 'loan_repayment' | 'loan_disbursement' | 'withdrawal';
  amount: number;
  currency: 'NGN';
  reference: string;
  contributionid?: string;
  loanid?: string;
  idempotencyKey: string;
  status: PaymentStatus;
  reconciliation: 'unmatched' | 'matched' | 'needs_review';
  createdAt: Date;
  paidAt?: Date;
  providerId?: string;
  recipientCode?: string;
  destination?: string;
}
export interface Loan {
  _id: ObjectId;
  id: string;
  memberId: string;
  amount: number;
  fee: number;
  totalDue: number;
  repaidAmount: number;
  reservedRepayment: number;
  months: number;
  purpose: string;
  status:
    | 'pending_review'
    | 'approved'
    | 'rejected'
    | 'disbursement_pending'
    | 'active'
    | 'repaid';
  termsVersion: string;
  consentAt: Date;
  eligibility: {
    investmentValue: number;
    maximum: number;
    source: string;
    verifiedAt: Date;
    expiresAt: Date;
  };
  createdAt: Date;
  decision?: { actor: string; reason: string; at: Date };
  disbursedAt?: Date;
  schedule?: { dueAt: Date; amount: number }[];
}
export interface MemberIdentity {
  localUserId: string;
  email: string;
  membershipStatus: string;
  termsVersion: string | null;
  currentTermsVersion: string;
}
