import mongoose, { Schema, Document, Types } from 'mongoose';

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface IExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface ITestCase {
  input: string;
  expectedOutput: string;
  /** Sample cases are shown to the user and used by "Run"; hidden ones only run on "Submit". */
  isSample: boolean;
}

export interface IStarterCode {
  language: string;
  code: string;
}

export interface IProblem extends Document<Types.ObjectId> {
  title: string;
  slug: string;
  difficulty: Difficulty;
  topic: string;
  url: string;
  source: string;
  order: number;
  active: boolean;
  // Original content for the in-house judge. False/absent for problems that still just link out
  // to LeetCode — only problems we've authored ourselves (never copied) turn this on.
  judgeEnabled: boolean;
  statement?: string;
  constraints?: string[];
  examples?: IExample[];
  starterCode?: IStarterCode[];
  testCases?: ITestCase[];
  timeLimitMs: number;
  memoryLimitMb: number;
  createdAt: Date;
  updatedAt: Date;
}

const ExampleSchema = new Schema<IExample>(
  {
    input: { type: String, required: true },
    output: { type: String, required: true },
    explanation: { type: String },
  },
  { _id: false }
);

const TestCaseSchema = new Schema<ITestCase>(
  {
    input: { type: String, required: true },
    expectedOutput: { type: String, required: true },
    isSample: { type: Boolean, default: false },
  },
  { _id: false }
);

const StarterCodeSchema = new Schema<IStarterCode>(
  {
    language: { type: String, required: true },
    code: { type: String, required: true },
  },
  { _id: false }
);

// Metadata and an external link only, by default. Problem statements are never copied from
// LeetCode — the optional judge fields below are only ever original content we write ourselves.
const ProblemSchema = new Schema<IProblem>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    topic: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    source: { type: String, required: true, default: 'LeetCode' },
    order: { type: Number, required: true },
    active: { type: Boolean, default: true },
    judgeEnabled: { type: Boolean, default: false },
    statement: { type: String },
    constraints: { type: [String], default: undefined },
    examples: { type: [ExampleSchema], default: undefined },
    starterCode: { type: [StarterCodeSchema], default: undefined },
    testCases: { type: [TestCaseSchema], default: undefined },
    timeLimitMs: { type: Number, default: 2000 },
    memoryLimitMb: { type: Number, default: 256 },
  },
  { timestamps: true }
);

ProblemSchema.index({ topic: 1, order: 1 });

export const Problem = mongoose.model<IProblem>('Problem', ProblemSchema);
