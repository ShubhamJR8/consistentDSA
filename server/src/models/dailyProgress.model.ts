import mongoose, { Schema, Document, Types } from 'mongoose';

export const DAY_STATUSES = ['PENDING', 'COMPLETED', 'MISSED'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export const COMPLETION_METHODS = ['SELF_REPORTED', 'JUDGE0', 'LEETCODE'] as const;
export type CompletionMethod = (typeof COMPLETION_METHODS)[number];

export interface ILeetCodeEvidence {
  submissionId?: string;
  title: string;
  titleSlug: string;
  /** Submission time, milliseconds since epoch. The provider supplies no submission id. */
  timestamp: number;
  /** When we decided this was sufficient evidence. */
  verifiedAt?: Date;
}

export interface IProblemCompletion {
  problemId: Types.ObjectId;
  completedAt: Date;
  /** How this problem got checked off — a manual tick, an accepted Judge0 submission, or a
   *  matching Accepted submission found on the user's connected LeetCode account. */
  method: CompletionMethod;
  submissionId?: Types.ObjectId;
  leetcodeEvidence?: ILeetCodeEvidence;
}

export interface IDailyProgress extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  commitmentId: Types.ObjectId;
  /** Calendar day (YYYY-MM-DD) in the commitment's timezone. */
  date: string;
  dayNumber: number;
  /** The problems assigned to this day, fixed at activation. */
  problemIds: Types.ObjectId[];
  requiredProblems: number;
  completedProblems: number;
  problemCompletions: IProblemCompletion[];
  status: DayStatus;
  completedAt: Date | null;
  /** Outcome of the most recent LeetCode check of this day. `inconclusive` = the provider failed or
   *  its history may have been truncated, so "nothing found" proves nothing — used to extend the
   *  grace period before the day can be marked missed. */
  lastVerification?: { checkedAt: Date; inconclusive: boolean };
}

const LeetCodeEvidenceSchema = new Schema<ILeetCodeEvidence>(
  {
    submissionId: { type: String },
    title: { type: String, required: true },
    titleSlug: { type: String, required: true },
    timestamp: { type: Number, required: true },
    verifiedAt: { type: Date },
  },
  { _id: false }
);

const ProblemCompletionSchema = new Schema<IProblemCompletion>(
  {
    problemId: { type: Schema.Types.ObjectId, ref: 'Problem', required: true },
    completedAt: { type: Date, required: true },
    method: { type: String, enum: COMPLETION_METHODS, default: 'SELF_REPORTED' },
    submissionId: { type: Schema.Types.ObjectId, ref: 'Submission' },
    leetcodeEvidence: { type: LeetCodeEvidenceSchema },
  },
  { _id: false }
);

// No `timestamps`: completion arrays are changed with aggregation-pipeline updates.
const DailyProgressSchema = new Schema<IDailyProgress>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  commitmentId: { type: Schema.Types.ObjectId, ref: 'Commitment', required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  dayNumber: { type: Number, required: true, min: 1 },
  problemIds: [{ type: Schema.Types.ObjectId, ref: 'Problem', required: true }],
  requiredProblems: { type: Number, required: true, min: 1 },
  completedProblems: { type: Number, default: 0, min: 0 },
  problemCompletions: { type: [ProblemCompletionSchema], default: [] },
  status: { type: String, enum: DAY_STATUSES, default: 'PENDING' },
  completedAt: { type: Date, default: null },
  lastVerification: {
    type: new Schema({ checkedAt: Date, inconclusive: Boolean }, { _id: false }),
    default: undefined,
  },
});

DailyProgressSchema.index({ userId: 1, commitmentId: 1, date: 1 }, { unique: true });
DailyProgressSchema.index({ commitmentId: 1, dayNumber: 1 });

export const DailyProgress = mongoose.model<IDailyProgress>('DailyProgress', DailyProgressSchema);
