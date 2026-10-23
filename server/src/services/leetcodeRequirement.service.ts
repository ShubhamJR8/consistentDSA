import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import type { IDailyProgress } from '../models/dailyProgress.model.js';
import { Problem } from '../models/problem.model.js';
import { IUser } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { endOfDay } from '../utils/localDate.js';

// A commitment can only be started by someone whose LeetCode account we can verify against —
// otherwise they'd pay a deposit and have no way to be auto-verified. Judge-enabled problems are
// checked in our own editor, so they don't count.

/** True if any problem in the list has to be verified through the user's LeetCode account. */
export const requiresLeetCode = async (problemIds: Types.ObjectId[]): Promise<boolean> =>
  (await Problem.exists({
    _id: { $in: problemIds },
    source: 'LeetCode',
    judgeEnabled: { $ne: true },
  })) !== null;

export const hasVerifiedLeetCode = (user: Pick<IUser, 'leetcodeUsername' | 'leetcodeVerifiedAt'>) =>
  Boolean(user.leetcodeUsername && user.leetcodeVerifiedAt);

/** Throws unless the user can start a commitment covering these problems. */
export const assertCanStartCommitment = async (
  user: Pick<IUser, 'leetcodeUsername' | 'leetcodeVerifiedAt'>,
  problemIds: Types.ObjectId[]
): Promise<void> => {
  if (hasVerifiedLeetCode(user) || !(await requiresLeetCode(problemIds))) return;
  throw ApiError.forbidden(
    'LEETCODE_VERIFICATION_REQUIRED',
    'Connect and verify your LeetCode account before starting a commitment.'
  );
};

/** Throws if the user's LeetCode account is committed to a commitment: a running one, or one with
 *  a deposit order already in flight (otherwise the account could be dropped between creating the
 *  order and paying it, and the post-payment activation can't re-check without stranding money). */
export const assertNoActiveCommitment = async (userId: string): Promise<void> => {
  const locked =
    (await Commitment.exists({ userId, status: 'ACTIVE' })) ??
    (await CommitmentTransaction.exists({
      userId,
      type: 'DEPOSIT',
      status: 'PENDING',
      commitmentId: {
        $in: (await Commitment.find({ userId, status: 'PENDING_PAYMENT' }).select('_id')).map(
          (c) => c._id
        ),
      },
    }));
  if (locked) {
    throw ApiError.conflict(
      'LEETCODE_LOCKED_BY_COMMITMENT',
      "Your LeetCode account can't be changed or disconnected while a commitment is active or a deposit is in progress."
    );
  }
};

/** When a day's verification grace ends. The invariant: a day is never marked missed on the strength
 *  of a check that could not have seen the evidence.
 *   - No check since the deadline (the sweep was down, nobody clicked) or the provider was unreachable
 *     at the last one: held up to the provider-down backstop — it is re-verified the moment a check
 *     can succeed, so this is a ceiling, not a delay everyone pays.
 *   - A check that worked but whose 20-submission window may have hidden a solve: a short cap, since
 *     waiting cannot make that history reappear.
 *   - A conclusive check after the deadline that found nothing: just the base grace, which covers
 *     the provider's own response cache. */
export const verificationGraceEnd = (progress: IDailyProgress, timezone: string): Date => {
  const deadline = endOfDay(progress.date, timezone).getTime();
  const last = progress.lastVerification;
  const checkedAfterDeadline = last !== undefined && last.checkedAt.getTime() >= deadline;

  const minutes =
    !checkedAfterDeadline || last?.providerUnavailable
      ? env.LEETCODE_GRACE_PROVIDER_DOWN_MAX_HOURS * 60
      : last?.inconclusive
        ? env.LEETCODE_GRACE_OUTAGE_MAX_HOURS * 60
        : env.LEETCODE_GRACE_MINUTES;
  return new Date(deadline + minutes * 60_000);
};

/** True if a PENDING day for a verified-account user is still inside its grace window and has
 *  something the LeetCode verifier could still check off. */
export const isInVerificationGrace = async (
  progress: IDailyProgress,
  timezone: string,
  now: Date
): Promise<boolean> => {
  if (now.getTime() > verificationGraceEnd(progress, timezone).getTime()) return false;
  const done = new Set(progress.problemCompletions.map((c) => c.problemId.toString()));
  const unfinished = progress.problemIds.filter((id) => !done.has(id.toString()));
  return requiresLeetCode(unfinished);
};
