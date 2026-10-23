export interface CommitmentRules {
  forfeitureMode: 'percentage';
  forfeiturePerMissedDay: number;
  graceDays: number;
}

export interface CommitmentOptions {
  dailyTargets: number[];
  depositAmounts: number[];
  recommendedDailyTarget: number;
  rules: CommitmentRules;
}

export type PlanLevel = 'Basic' | 'Medium' | 'Advanced';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface PlanSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  topic: string | null;
  level: PlanLevel | null;
  problemCount: number;
  /** True if starting this plan needs a verified LeetCode account. */
  requiresLeetCode: boolean;
}

export interface Problem {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  topic: string;
  url: string;
  source: string;
  order: number;
}

export interface PlanDetail extends PlanSummary {
  problems: Problem[];
}

export type CommitmentStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Commitment {
  id: string;
  planId: string;
  planName: string;
  status: CommitmentStatus;
  timezone: string;
  startDate: string | null;
  endDate: string | null;
  /** Only while awaiting payment: the day Day 1 would start if payment landed now. */
  projectedStartDate: string | null;
  durationDays: number;
  dailyTarget: number;
  totalProblems: number;
  depositAmount: number;
  currentProtectedAmount: number;
  currentForfeitedAmount: number;
  currentStreak: number;
  longestStreak: number;
  completedDays: number;
  missedDays: number;
  rules: CommitmentRules;
  createdAt: string;
}

// durationDays is never sent — the server derives it from the plan's problem count and dailyTarget.
export interface CreateCommitmentInput {
  planId: string;
  dailyTarget: number;
  depositAmount: number;
}

export type DayStatus = 'PENDING' | 'COMPLETED' | 'MISSED';
export type Phase = 'NOT_STARTED' | 'IN_PROGRESS' | 'ENDED';

export interface TodayProblem {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  topic: string;
  url: string;
  source: string;
  order: number;
  judgeEnabled: boolean;
  completed: boolean;
  completedAt: string | null;
  /** How it was checked off; 'LEETCODE' = verified against the user's LeetCode account. */
  completionMethod: 'SELF_REPORTED' | 'JUDGE0' | 'LEETCODE' | null;
}

export interface TodayDetails {
  date: string;
  dayNumber: number;
  status: DayStatus;
  requiredProblems: number;
  completedProblems: number;
  deadlineAt: string;
  completedAt: string | null;
  problems: TodayProblem[];
}

export interface TodayResponse {
  phase: Phase;
  serverTime: string;
  commitment: Commitment;
  today: TodayDetails | null;
}

export interface ProgressDay {
  date: string;
  dayNumber: number;
  status: DayStatus;
  requiredProblems: number;
  completedProblems: number;
  isToday: boolean;
  isUpcoming: boolean;
  problems: TodayProblem[];
}

export interface ProgressResponse {
  serverTime: string;
  commitment: Commitment;
  days: ProgressDay[];
}

export type ProblemVerificationStatus =
  'VERIFIED' | 'PENDING' | 'TEMPORARILY_UNAVAILABLE' | 'CONFIGURATION_ERROR';

export interface ProblemVerification {
  problemId: string;
  slug: string;
  status: ProblemVerificationStatus;
  /** 'history_truncated' = LeetCode's recent-submissions window may have hidden an older solve. */
  reason?: string;
}

export interface LeetCodeVerifyResult {
  checkedAt: string;
  /** False if LeetCode couldn't be reached this call — nothing was marked missed because of it. */
  providerAvailable: boolean;
  /** True when this check finished the last outstanding problem and completed the day. */
  dayCompleted: boolean;
  verifiedProblemIds: string[];
  stillPendingProblemIds: string[];
  problems: ProblemVerification[];
}

export interface PaymentOrder {
  /** Safe to hand to Razorpay Checkout — the secret never leaves the server. */
  keyId: string;
  orderId: string;
  /** Paise (smallest currency unit), what Checkout expects. */
  amount: number;
  currency: string;
}

export interface VerifyPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export type LedgerTransactionType = 'DEPOSIT' | 'FORFEITURE' | 'REFUND';
export type LedgerTransactionStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

export interface LedgerTransaction {
  id: string;
  type: LedgerTransactionType;
  amount: number;
  status: LedgerTransactionStatus;
  reference: string;
  createdAt: string;
}

export interface Ledger {
  commitment: Commitment;
  transactions: LedgerTransaction[];
}
