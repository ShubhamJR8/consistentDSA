import {
  LeetCodeAcceptedSubmission,
  LeetCodeClient,
  LeetCodeProviderError,
  leetCodeClient,
} from '../../integrations/leetcode/leetcode.client.js';
import { ILeetCodeEvidence } from '../../models/dailyProgress.model.js';

// Outcomes are deliberately three-valued. PENDING means "no evidence yet" and UNAVAILABLE means
// "couldn't tell" — neither is ever a verdict that the user failed; only VERIFIED has consequences.
export interface VerificationResult {
  status: 'VERIFIED' | 'PENDING' | 'UNAVAILABLE';
  source: 'leetcode';
  externalProblemId: string;
  completedAt?: Date;
  evidence?: ILeetCodeEvidence;
  reason?: 'provider_unavailable' | 'no_matching_submission' | 'history_truncated';
}

export interface VerifyCompletionsInput {
  username: string;
  /** Canonical LeetCode slugs of the problems to look for, already derived server-side. */
  problemSlugs: string[];
  windowStart: Date;
  windowEnd: Date;
}

export interface CompletionVerificationProvider {
  /** One result per requested slug, from a single provider fetch. Never throws. */
  verifyCompletions(input: VerifyCompletionsInput): Promise<Map<string, VerificationResult>>;
}

export class LeetCodeVerificationProvider implements CompletionVerificationProvider {
  constructor(private readonly client: LeetCodeClient = leetCodeClient) {}

  async verifyCompletions(input: VerifyCompletionsInput): Promise<Map<string, VerificationResult>> {
    const results = new Map<string, VerificationResult>();
    const base = (slug: string) => ({ source: 'leetcode' as const, externalProblemId: slug });

    let fetched;
    try {
      fetched = await this.client.getAcceptedSubmissions(input.username);
    } catch (error) {
      if (!(error instanceof LeetCodeProviderError)) throw error;
      // Retryable — not evidence about the user.
      for (const slug of input.problemSlugs) {
        results.set(slug, { ...base(slug), status: 'UNAVAILABLE', reason: 'provider_unavailable' });
      }
      return results;
    }

    const { submissions, limit } = fetched;
    const start = input.windowStart.getTime();
    const end = input.windowEnd.getTime();

    // The provider only ever returns the newest `limit` Accepted submissions. If it handed back a
    // full page and even the oldest entry is still inside the window, anything solved earlier in
    // the window may have been cut off — so "not found" is indeterminate, not "not solved".
    const oldest = submissions.length > 0 ? submissions[submissions.length - 1].timestamp : null;
    const historyComplete = submissions.length < limit || (oldest !== null && oldest < start);

    for (const slug of input.problemSlugs) {
      // Earliest qualifying Accepted submission is the evidence; repeats don't matter.
      let match: LeetCodeAcceptedSubmission | undefined;
      for (const submission of submissions) {
        if (submission.titleSlug !== slug) continue;
        if (submission.timestamp < start || submission.timestamp > end) continue;
        if (!match || submission.timestamp < match.timestamp) match = submission;
      }

      if (match) {
        results.set(slug, {
          ...base(slug),
          status: 'VERIFIED',
          completedAt: new Date(match.timestamp),
          // Only what the provider actually supplied: it gives no submission id.
          evidence: {
            title: match.title,
            titleSlug: match.titleSlug,
            timestamp: match.timestamp,
            verifiedAt: new Date(),
          },
        });
      } else {
        results.set(slug, {
          ...base(slug),
          status: 'PENDING',
          reason: historyComplete ? 'no_matching_submission' : 'history_truncated',
        });
      }
    }
    return results;
  }
}

export const leetCodeVerificationProvider: CompletionVerificationProvider =
  new LeetCodeVerificationProvider();
