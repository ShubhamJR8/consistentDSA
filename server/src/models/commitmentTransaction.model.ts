import mongoose, { Schema, Document, Types } from 'mongoose';

export const TRANSACTION_TYPES = ['DEPOSIT', 'FORFEITURE', 'REFUND'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Why a REFUND row exists. Absent/SETTLEMENT = the end-of-commitment refund of what wasn't forfeited;
 *  the others return a full payment that should never have stuck. */
export const REFUND_REASONS = ['SETTLEMENT', 'DUPLICATE_PAYMENT', 'UNACTIVATABLE'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

// PROCESSING (REFUND only): a refund call is in flight or its outcome is unknown. It is never retried
// blindly — the refund script first looks for the refund on Razorpay (see scripts/refunds.ts).
export const TRANSACTION_STATUSES = ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

// The auditable financial history behind a commitment — never mutate depositAmount/
// currentForfeitedAmount in place without also writing a row here. Amounts are always positive
// rupees; the `type` conveys direction (DEPOSIT/REFUND in, FORFEITURE out).
export interface ICommitmentTransaction extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  commitmentId: Types.ObjectId;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  /** Razorpay order/payment id for DEPOSIT and REFUND rows, a short reason for FORFEITURE. */
  reference: string;
  razorpayOrderId?: string;
  /** DEPOSIT: the payment that was captured. REFUND: the *original* payment being refunded
   *  against — set at creation so the manual refund script knows what to call Razorpay with. */
  razorpayPaymentId?: string;
  /** REFUND only: Razorpay's refund id, set once the refund is actually executed. Kept separate
   *  from razorpayPaymentId so "which payment is this refunding" and "did the refund happen, and
   *  with what id" are never conflated. */
  razorpayRefundId?: string;
  /** REFUND only. */
  refundReason?: RefundReason;
  /** DEPOSIT only: the latest Razorpay dispute (chargeback) state for the payment, as reported by
   *  webhook — e.g. created, under_review, won, lost. Anything but 'won' blocks refunding it. */
  /** FORFEITURE only: the YYYY-MM-DD day this row accounts for, so a day can be recorded only once. */
  dayKey?: string;
  disputeId?: string;
  disputeStatus?: string;
  createdAt: Date;
}

const CommitmentTransactionSchema = new Schema<ICommitmentTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    commitmentId: { type: Schema.Types.ObjectId, ref: 'Commitment', required: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: TRANSACTION_STATUSES, default: 'PENDING' },
    reference: { type: String, required: true, trim: true },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpayRefundId: { type: String },
    refundReason: { type: String, enum: REFUND_REASONS },
    dayKey: { type: String },
    disputeId: { type: String },
    disputeStatus: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CommitmentTransactionSchema.index({ commitmentId: 1, createdAt: 1 });
CommitmentTransactionSchema.index({ razorpayOrderId: 1 });
CommitmentTransactionSchema.index({ razorpayPaymentId: 1 });

// A missed day is forfeited at most once, however many reconcile() calls (list, sweep, several tabs)
// race to record it or retry after a crash.
CommitmentTransactionSchema.index(
  { commitmentId: 1, dayKey: 1 },
  {
    unique: true,
    name: 'one_forfeiture_per_day',
    partialFilterExpression: { type: 'FORFEITURE', dayKey: { $exists: true } },
  }
);

// A payment is refunded at most once — the backstop against double-queuing under concurrent
// reconcile()/webhook calls (replaces the old one-refund-per-commitment index, which could not
// represent a duplicate payment that needs its own full refund).
CommitmentTransactionSchema.index(
  { razorpayPaymentId: 1, type: 1 },
  { unique: true, name: 'one_refund_per_payment', partialFilterExpression: { type: 'REFUND' } }
);

// At most one deposit attempt in flight per commitment: concurrent "Pay" clicks / tabs cannot mint
// several Razorpay orders, each of which could be paid separately.
CommitmentTransactionSchema.index(
  { commitmentId: 1 },
  {
    unique: true,
    name: 'one_pending_deposit',
    partialFilterExpression: { type: 'DEPOSIT', status: 'PENDING' },
  }
);

// At most one *successful* deposit per commitment. A second captured payment loses this race
// atomically and is routed to a full refund instead of being recorded as a normal deposit.
CommitmentTransactionSchema.index(
  { commitmentId: 1 },
  {
    unique: true,
    name: 'one_successful_deposit',
    partialFilterExpression: { type: 'DEPOSIT', status: 'SUCCESS' },
  }
);

export const CommitmentTransaction = mongoose.model<ICommitmentTransaction>(
  'CommitmentTransaction',
  CommitmentTransactionSchema
);
