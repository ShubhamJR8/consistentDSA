import mongoose, { Schema, Document, Types } from 'mongoose';

export const TRANSACTION_TYPES = ['DEPOSIT', 'FORFEITURE', 'REFUND'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['PENDING', 'SUCCESS', 'FAILED'] as const;
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
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CommitmentTransactionSchema.index({ commitmentId: 1, createdAt: 1 });
CommitmentTransactionSchema.index({ razorpayOrderId: 1 });

// A commitment is ever eligible for exactly one refund (issued once, at settlement) — this is
// the backstop against double-queuing under concurrent reconcile() calls, same pattern as the
// one-open-commitment-per-user index on Commitment.
CommitmentTransactionSchema.index(
  { commitmentId: 1, type: 1 },
  { unique: true, name: 'one_refund_per_commitment', partialFilterExpression: { type: 'REFUND' } }
);

export const CommitmentTransaction = mongoose.model<ICommitmentTransaction>(
  'CommitmentTransaction',
  CommitmentTransactionSchema
);
