import { ILeetCodeEvidence } from '../../models/dailyProgress.model.js';
import { leetCodeClient, LeetCodeClient } from '../../integrations/leetcode/leetcode.client.js';

export interface VerificationResult {
  status: 'VERIFIED' | 'PENDING' | 'FAILED';
  source: 'leetcode';
  externalProblemId: string;
  completedAt?: Date;
  evidence?: ILeetCodeEvidence;
  reason?: 'provider_unavailable' | 'username_not_found' | 'no_matching_submission';
}

export interface CompletionVerificationProvider {
  verifyCompletion(input: {
    username: string;
    problemSlug: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<VerificationResult>;
}

// Never throws — an unreachable LeetCode is a PENDING result to retry later, not a hard failure,
// since money is on the line and we must not penalize a user for LeetCode being briefly down.
export class LeetCodeVerificationProvider implements CompletionVerificationProvider {
  constructor(private readonly client: LeetCodeClient = leetCodeClient) {}

  async verifyCompletion(input: {
    username: string;
    problemSlug: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<VerificationResult> {
    const base = { source: 'leetcode' as const, externalProblemId: input.problemSlug };

    let submissions: Awaited<ReturnType<LeetCodeClient['getRecentSubmissions']>>;
    try {
      submissions = await this.client.getRecentSubmissions(input.username);
    } catch {
      return { ...base, status: 'PENDING', reason: 'provider_unavailable' };
    }

    if (submissions === null) {
      return { ...base, status: 'PENDING', reason: 'username_not_found' };
    }

    const match = submissions.find(
      (submission) =>
        submission.titleSlug === input.problemSlug &&
        submission.statusDisplay === 'Accepted' &&
        submission.timestamp >= input.windowStart.getTime() &&
        submission.timestamp <= input.windowEnd.getTime()
    );

    if (!match) {
      return { ...base, status: 'PENDING', reason: 'no_matching_submission' };
    }

    return {
      ...base,
      status: 'VERIFIED',
      completedAt: new Date(match.timestamp),
      evidence: {
        submissionId: match.id,
        title: match.title,
        titleSlug: match.titleSlug,
        timestamp: match.timestamp,
      },
    };
  }
}

export const leetCodeVerificationProvider: CompletionVerificationProvider =
  new LeetCodeVerificationProvider();
