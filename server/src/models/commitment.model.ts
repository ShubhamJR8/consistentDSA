import mongoose, { Schema, Document, Types } from 'mongoose';

export const COMMITMENT_STATUSES = [
  'PENDING_PAYMENT',
  'ACTIVE',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const OPEN_STATUSES: readonly CommitmentStatus[] = ['PENDING_PAYMENT', 'ACTIVE'];

export interface ICommitmentRules {
  forfeitureMode: 'percentage';
  forfeiturePerMissedDay: number;
  graceDays: number;
}

export interface ICommitment extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  planName: string;
  timezone: string;
  /** YYYY-MM-DD in `timezone`; null until the commitment is activated. */
  startDate: string | null;
  endDate: string | null;
  /** Always ceil(totalProblems / dailyTarget) at creation — never chosen directly. */
  durationDays: number;
  dailyTarget: number;
  /** The chosen plan's full problem count at creation time; a commitment always covers every
   *  problem in its plan, never a subset. Stored (not recomputed) so it stays correct even if
   *  the plan's problem count later changes. */
  totalProblems: number;
  /** Whole rupees. */
  depositAmount: number;
  currentProtectedAmount: number;
  currentForfeitedAmount: number;
  status: CommitmentStatus;
  currentStreak: number;
  longestStreak: number;
  completedDays: number;
  missedDays: number;
  /** Snapshot taken at creation. Later rule changes never touch existing commitments. */
  rules: ICommitmentRules;
  createdAt: Date;
  updatedAt: Date;
}

const RulesSchema = new Schema<ICommitmentRules>(
  {
    forfeitureMode: { type: String, enum: ['percentage'], required: true },
    forfeiturePerMissedDay: { type: Number, required: true, min: 0, max: 100 },
    graceDays: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const CommitmentSchema = new Schema<ICommitment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan', required: true },
    planName: { type: String, required: true },
    timezone: { type: String, required: true },
    startDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    durationDays: { type: Number, required: true, min: 1 },
    dailyTarget: { type: Number, required: true, min: 1 },
    totalProblems: { type: Number, required: true, min: 1 },
    depositAmount: { type: Number, required: true, min: 1 },
    currentProtectedAmount: { type: Number, default: 0, min: 0 },
    currentForfeitedAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: COMMITMENT_STATUSES, default: 'PENDING_PAYMENT' },
    currentStreak: { type: Number, default: 0, min: 0 },
    longestStreak: { type: Number, default: 0, min: 0 },
    completedDays: { type: Number, default: 0, min: 0 },
    missedDays: { type: Number, default: 0, min: 0 },
    rules: { type: RulesSchema, required: true },
  },
  { timestamps: true }
);

CommitmentSchema.index({ userId: 1, status: 1 });

// Backstop for the "one open commitment per user" rule under concurrent requests.
CommitmentSchema.index(
  { userId: 1 },
  {
    unique: true,
    name: 'one_open_commitment_per_user',
    partialFilterExpression: { status: { $in: [...OPEN_STATUSES] } },
  }
);

export const Commitment = mongoose.model<ICommitment>('Commitment', CommitmentSchema);
