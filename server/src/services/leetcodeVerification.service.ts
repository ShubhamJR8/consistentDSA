import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { endOfDay, startOfDay } from '../utils/localDate.js';
import { DailyProgressService } from './dailyProgress.service.js';
import {
  CompletionVerificationProvider,
  leetCodeVerificationProvider,
} from './providers/leetcodeVerification.provider.js';

export interface LeetCodeVerifyResultDto {
  checkedAt: Date;
  /** False if LeetCode couldn't be reached this call — nothing was marked missed because of it. */
  providerAvailable: boolean;
  verifiedProblemIds: string[];
  stillPendingProblemIds: string[];
}

const log = (line: Record<string, string>): void => {
  const tags = Object.entries(line)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`[LeetCodeVerification] ${tags}`);
};

export class LeetCodeVerificationService {
  /** Checks every one of today's not-yet-completed problems against the user's connected
   *  LeetCode account, and checks off whichever ones have a matching Accepted submission inside
   *  today's window. Safe to call repeatedly — already-completed problems are left untouched. */
  static async verifyToday(
    userId: string,
    commitmentId: string,
    now: Date = new Date(),
    provider: CompletionVerificationProvider = leetCodeVerificationProvider
  ): Promise<LeetCodeVerifyResultDto> {
    const user = await User.findById(userId);
    if (!user?.leetcodeUsername) {
      throw ApiError.badRequest(
        'LEETCODE_NOT_CONNECTED',
        'Connect your LeetCode username first.'
      );
    }

    const { commitment, progress } = await DailyProgressService.loadDayForWrite(
      userId,
      commitmentId,
      now
    );

    const completedIds = new Set(progress.problemCompletions.map((c) => c.problemId.toString()));
    const unsolvedIds = progress.problemIds.filter((id) => !completedIds.has(id.toString()));

    if (unsolvedIds.length === 0) {
      return { checkedAt: now, providerAvailable: true, verifiedProblemIds: [], stillPendingProblemIds: [] };
    }

    const problems = await Problem.find({ _id: { $in: unsolvedIds } });
    const windowStart = startOfDay(progress.date, commitment.timezone);
    const windowEnd = endOfDay(progress.date, commitment.timezone);

    const verifiedProblemIds: string[] = [];
    const stillPendingProblemIds: string[] = [];
    let providerAvailable = true;

    for (const problem of problems) {
      const result = await provider.verifyCompletion({
        username: user.leetcodeUsername,
        problemSlug: problem.slug,
        windowStart,
        windowEnd,
      });

      if (result.status === 'VERIFIED' && result.evidence) {
        await DailyProgressService.recordLeetCodeCompletion(
          progress._id,
          problem._id,
          result.evidence,
          result.completedAt ?? now
        );
        verifiedProblemIds.push(problem._id.toString());
        log({
          user: userId,
          commitment: commitmentId,
          problem: problem.slug,
          status: 'VERIFIED',
          submission: result.evidence.submissionId ?? '',
        });
      } else {
        if (result.reason === 'provider_unavailable') providerAvailable = false;
        stillPendingProblemIds.push(problem._id.toString());
        log({
          user: userId,
          commitment: commitmentId,
          problem: problem.slug,
          status: result.status,
          reason: result.reason ?? '',
        });
      }
    }

    return { checkedAt: now, providerAvailable, verifiedProblemIds, stillPendingProblemIds };
  }
}
