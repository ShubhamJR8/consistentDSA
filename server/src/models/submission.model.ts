import mongoose, { Schema, Document, Types } from 'mongoose';

export const SUBMISSION_STATUSES = [
  'ACCEPTED',
  'WRONG_ANSWER',
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'TIME_LIMIT_EXCEEDED',
  'JUDGE_ERROR',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface ITestResult {
  index: number;
  passed: boolean;
  isSample: boolean;
  stdout?: string;
  stderr?: string;
  timeMs?: number;
}

export interface ISubmission extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  commitmentId: Types.ObjectId;
  problemId: Types.ObjectId;
  language: string;
  code: string;
  status: SubmissionStatus;
  passedCount: number;
  totalCount: number;
  results: ITestResult[];
  submittedAt: Date;
  judgedAt: Date | null;
}

const TestResultSchema = new Schema<ITestResult>(
  {
    index: { type: Number, required: true },
    passed: { type: Boolean, required: true },
    isSample: { type: Boolean, required: true },
    stdout: { type: String },
    stderr: { type: String },
    timeMs: { type: Number },
  },
  { _id: false }
);

// The full audit trail of a "Submit" — every test case, not just the samples — so a completion
// can always be traced back to a specific run of specific code if it's ever disputed.
const SubmissionSchema = new Schema<ISubmission>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  commitmentId: { type: Schema.Types.ObjectId, ref: 'Commitment', required: true },
  problemId: { type: Schema.Types.ObjectId, ref: 'Problem', required: true },
  language: { type: String, required: true },
  code: { type: String, required: true, maxlength: 20_000 },
  status: { type: String, enum: SUBMISSION_STATUSES, required: true },
  passedCount: { type: Number, required: true, min: 0 },
  totalCount: { type: Number, required: true, min: 0 },
  results: { type: [TestResultSchema], default: [] },
  submittedAt: { type: Date, default: Date.now },
  judgedAt: { type: Date, default: null },
});

SubmissionSchema.index({ userId: 1, problemId: 1, commitmentId: 1, submittedAt: -1 });

export const Submission = mongoose.model<ISubmission>('Submission', SubmissionSchema);
