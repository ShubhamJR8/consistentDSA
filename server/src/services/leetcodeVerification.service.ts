import { IProblem, Problem } from '../models/problem.model.js';
import { IUser, User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { dayKeyFor, endOfDay, startOfDay } from '../utils/localDate.js';
import { Types } from 'mongoose';
import { DailyProgress, IDailyProgress } from '../models/dailyProgress.model.js';
import { ICommitment } from '../models/commitment.model.js';
import { getOwnedCommitment } from './commitment.shared.js';
import { isInVerificationGrace } from './leetcodeRequirement.service.js';
import { DailyProgressService } from './dailyProgress.service.js';
import {
  CompletionVerificationProvider,
  leetCodeVerificationProvider,
} from './providers/leetcodeVerification.provider.js';

// Every outcome here is about *evidence*, never about misconduct. Nothing in this service marks a
// day missed or touches deposits/refunds: the only state it writes is "this problem is done", and
// the day itself is finalized through DailyProgressService.completeDay's existing rules.

export type ProblemVerificationStatus =
  'VERIFIED' | 'PENDING' | 'TEMPORARILY_UNAVAILABLE' | 'CONFIGURATION_ERROR';

export interface ProblemVerificationDto {
  problemId: string;
  slug: string;
  status: ProblemVerificationStatus;
  /** 'history_truncated' = provider's 20-submission window may have hidden an older solve. */
  reason?: string;
}

export interface LeetCodeVerifyResultDto {
  checkedAt: Date;
  /** False if LeetCode couldn't be reached this call — nothing was marked missed because of it. */
  providerAvailable: boolean;
  /** True when this check completed the last outstanding problem and finalized the day. */
  dayCompleted: boolean;
  verifiedProblemIds: string[];
  stillPendingProblemIds: string[];
  problems: ProblemVerificationDto[];
}

const log = (line: Record<string, string>): void => {
  const tags = Object.entries(line)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`[LeetCodeVerification] ${tags}`);
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A problem is only verifiable against LeetCode if its stored slug is a plausible LeetCode slug and
 *  agrees with its stored URL — otherwise we'd be matching submissions against the wrong thing. */
export const isLeetCodeConfigured = (problem: IProblem): boolean => {
  if (problem.source !== 'LeetCode' || !SLUG_PATTERN.test(problem.slug)) return false;
  try {
    const url = new URL(problem.url);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'leetcode.com' &&
      url.pathname.split('/').filter(Boolean).slice(0, 2).join('/') === `problems/${problem.slug}`
    );
  } catch {
    return false;
  }
};

export class LeetCodeVerificationService {
  /** Checks every one of today's not-yet-completed problems — derived server-side from the
   *  authenticated user's active commitment — against their verified LeetCode account, checks off
   *  whichever have a matching Accepted submission inside today's window, and finalizes the day once
   *  every assigned problem is done. Idempotent: completed problems are never re-processed. */
  static async verifyToday(
    userId: string,
    commitmentId: string,
    now: Date = new Date(),
    provider: CompletionVerificationProvider = leetCodeVerificationProvider
  ): Promise<LeetCodeVerifyResultDto> {
    const user = await User.findById(userId);
    if (!user?.leetcodeUsername || !user.leetcodeVerifiedAt) {
      throw ApiError.badRequest(
        'LEETCODE_NOT_CONNECTED',
        'Connect and verify your LeetCode account first.'
      );
    }

    // Also enforces that the commitment belongs to this user and is ACTIVE.
    const { commitment, progress } = await DailyProgressService.loadDayForWrite(
      userId,
      commitmentId,
      now
    );

    // The previous day may still be inside its verification grace (see leetcodeRequirement.service);
    // checking it here means a manual check also rescues a solve made just before midnight.
    await this.verifyGraceDays(userId, commitmentId, now, provider).catch(() => undefined);

    return this.verifyProgress(user, commitment, progress, now, provider);
  }

  /** Re-verifies any earlier PENDING day of this commitment that is still inside its grace window.
   *  Used by the sweep and by manual checks; days past their grace are left for reconcile(). */
  static async verifyGraceDays(
    userId: string,
    commitmentId: string,
    now: Date = new Date(),
    provider: CompletionVerificationProvider = leetCodeVerificationProvider
  ): Promise<void> {
    const user = await User.findById(userId);
    if (!user?.leetcodeUsername || !user.leetcodeVerifiedAt) return;
    const commitment = await getOwnedCommitment(userId, commitmentId);
    if (commitment.status !== 'ACTIVE') return;

    const overdue = await DailyProgress.find({
      commitmentId: commitment._id,
      status: 'PENDING',
      date: { $lt: dayKeyFor(now, commitment.timezone) },
    });
    for (const day of overdue) {
      if (await isInVerificationGrace(day, commitment.timezone, now)) {
        await this.verifyProgress(user, commitment, day, now, provider);
      }
    }
  }

  /** Verifies one specific day's unchecked problems. The caller has already established that the
   *  commitment belongs to the user and that this day may still be verified. */
  private static async verifyProgress(
    user: IUser,
    commitment: ICommitment,
    progress: IDailyProgress,
    now: Date,
    provider: CompletionVerificationProvider
  ): Promise<LeetCodeVerifyResultDto> {
    const userId = user._id.toString();
    const commitmentId = commitment._id.toString();
    const username = user.leetcodeUsername!;

    const empty = (dayCompleted: boolean): LeetCodeVerifyResultDto => ({
      checkedAt: now,
      providerAvailable: true,
      dayCompleted,
      verifiedProblemIds: [],
      stillPendingProblemIds: [],
      problems: [],
    });
    if (progress.status !== 'PENDING') return empty(progress.status === 'COMPLETED');

    const completedIds = new Set(progress.problemCompletions.map((c) => c.problemId.toString()));
    const unsolvedIds = progress.problemIds.filter((id) => !completedIds.has(id.toString()));
    if (unsolvedIds.length === 0) return empty(false);

    const found = await Problem.find({ _id: { $in: unsolvedIds } });
    const byId = new Map(found.map((p) => [p._id.toString(), p]));
    const problems = unsolvedIds.flatMap((id) => {
      const problem = byId.get(id.toString());
      return problem ? [problem] : [];
    });

    const outcomes: ProblemVerificationDto[] = [];
    const verifiable = problems.filter((problem) => {
      if (isLeetCodeConfigured(problem)) return true;
      outcomes.push({
        problemId: problem._id.toString(),
        slug: problem.slug,
        status: 'CONFIGURATION_ERROR',
        reason: 'problem_not_configured',
      });
      log({ commitment: commitmentId, problem: problem.slug, status: 'CONFIGURATION_ERROR' });
      return false;
    });

    const results =
      verifiable.length > 0
        ? await provider.verifyCompletions({
            username,
            problemSlugs: verifiable.map((p) => p.slug),
            windowStart: startOfDay(progress.date, commitment.timezone),
            windowEnd: endOfDay(progress.date, commitment.timezone),
          })
        : new Map();

    for (const problem of verifiable) {
      const result = results.get(problem.slug);
      const base = { problemId: problem._id.toString(), slug: problem.slug };

      if (result?.status === 'VERIFIED' && result.evidence) {
        await DailyProgressService.recordLeetCodeCompletion(
          progress._id,
          problem._id,
          result.evidence,
          result.completedAt ?? now
        );
        outcomes.push({ ...base, status: 'VERIFIED' });
        log({ user: userId, commitment: commitmentId, problem: problem.slug, status: 'VERIFIED' });
      } else {
        const unavailable = !result || result.status === 'UNAVAILABLE';
        outcomes.push({
          ...base,
          status: unavailable ? 'TEMPORARILY_UNAVAILABLE' : 'PENDING',
          reason: result?.reason ?? 'provider_unavailable',
        });
        log({
          user: userId,
          commitment: commitmentId,
          problem: problem.slug,
          status: unavailable ? 'TEMPORARILY_UNAVAILABLE' : 'PENDING',
          reason: result?.reason ?? 'provider_unavailable',
        });
      }
    }

    // Inconclusive = the provider failed or its 20-entry history may have hidden a solve. That is
    // what extends the grace before this day can be marked missed.
    const inconclusive = outcomes.some(
      (o) =>
        o.status === 'TEMPORARILY_UNAVAILABLE' ||
        (o.status === 'PENDING' && o.reason === 'history_truncated')
    );
    const providerUnavailable = outcomes.some((o) => o.status === 'TEMPORARILY_UNAVAILABLE');
    await DailyProgress.updateOne(
      { _id: progress._id },
      { $set: { lastVerification: { checkedAt: now, inconclusive, providerUnavailable } } }
    );

    const verifiedProblemIds = outcomes
      .filter((o) => o.status === 'VERIFIED')
      .map((o) => o.problemId);
    const dayCompleted =
      verifiedProblemIds.length > 0 && (await this.finalizeIfDone(commitment, progress._id, now));

    return {
      checkedAt: now,
      providerAvailable: !providerUnavailable,
      dayCompleted,
      verifiedProblemIds,
      stillPendingProblemIds: outcomes
        .filter((o) => o.status !== 'VERIFIED')
        .map((o) => o.problemId),
      problems: outcomes,
    };
  }

  /** Once every assigned problem is checked off, completes the day through the existing
   *  finalizeDay path — which is what updates the streak, attendance and commitment totals — so a
   *  fully verified day doesn't wait on a manual click. */
  private static async finalizeIfDone(
    commitment: ICommitment,
    progressId: Types.ObjectId,
    now: Date
  ): Promise<boolean> {
    const latest = await DailyProgress.findById(progressId);
    if (!latest || latest.completedProblems < latest.requiredProblems) return false;
    try {
      return await DailyProgressService.finalizeDay(commitment, latest, now);
    } catch (error) {
      // The problems stay checked off; the user can still finish the day by hand.
      console.error('[LeetCodeVerification] could not finalize day', {
        commitment: commitment._id.toString(),
        error,
      });
      return false;
    }
  }
}
