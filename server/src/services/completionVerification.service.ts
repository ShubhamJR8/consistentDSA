import type { IDailyProgress } from '../models/dailyProgress.model.js';

export interface VerificationResult {
  verified: boolean;
  reason?: string;
}

// A day can mix all three kinds of problems: judge-enabled ones are only ever checked off by an
// accepted Judge0 submission (see SubmissionService), LeetCode-linked ones can be auto-verified
// once a username is connected (see LeetCodeVerificationService), and everything else is still
// self-reported. MIXED means more than one method contributed to the same day.
export interface VerificationStatus {
  method: 'SELF_REPORTED' | 'JUDGE0' | 'LEETCODE' | 'MIXED';
  verified: boolean;
}

/** Decides whether a day's work counts. The rule itself ("every assigned problem checked off")
 *  doesn't change with judge0 — what changed is *how* a problem gets checked off in the first
 *  place, which is enforced in DailyProgressService/SubmissionService, not here. */
export interface CompletionVerificationService {
  verifyDailyCompletion(progress: IDailyProgress): Promise<VerificationResult>;
  getVerificationStatus(progress: IDailyProgress): Promise<VerificationStatus>;
}

const allAssignedProblemsChecked = (progress: IDailyProgress): boolean => {
  const done = new Set(progress.problemCompletions.map((c) => c.problemId.toString()));
  return progress.problemIds.every((id) => done.has(id.toString()));
};

export class HybridVerificationService implements CompletionVerificationService {
  async verifyDailyCompletion(progress: IDailyProgress): Promise<VerificationResult> {
    if (!allAssignedProblemsChecked(progress)) {
      return { verified: false, reason: "Check off all of today's problems first." };
    }
    return { verified: true };
  }

  async getVerificationStatus(progress: IDailyProgress): Promise<VerificationStatus> {
    const methods = new Set(progress.problemCompletions.map((c) => c.method));
    const method: VerificationStatus['method'] =
      methods.size === 0 ? 'SELF_REPORTED' : methods.size > 1 ? 'MIXED' : [...methods][0];
    return { method, verified: progress.status === 'COMPLETED' };
  }
}

export const completionVerification: CompletionVerificationService = new HybridVerificationService();
