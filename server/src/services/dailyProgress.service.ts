import { Types } from 'mongoose';
import { Commitment, CommitmentStatus, ICommitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import {
  CompletionMethod,
  DailyProgress,
  DayStatus,
  IDailyProgress,
  ILeetCodeEvidence,
} from '../models/dailyProgress.model.js';
import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { addDays, dayKeyFor, endOfDay } from '../utils/localDate.js';
import {
  CommitmentDto,
  getOwnedCommitment,
  requireActive,
  toCommitmentDto,
} from './commitment.shared.js';
import { completionVerification } from './completionVerification.service.js';
import { hasVerifiedLeetCode, isInVerificationGrace } from './leetcodeRequirement.service.js';
import { ProblemDto, toProblemDto } from './problem.service.js';
import { queueRefundIfEligible } from './settlement.service.js';

export type Phase = 'NOT_STARTED' | 'IN_PROGRESS' | 'ENDED';

export interface TodayProblemDto extends ProblemDto {
  completed: boolean;
  completedAt: Date | null;
  /** How it was checked off (e.g. 'LEETCODE' = verified against the user's LeetCode account). */
  completionMethod: CompletionMethod | null;
}

export interface TodayDto {
  date: string;
  dayNumber: number;
  status: DayStatus;
  requiredProblems: number;
  completedProblems: number;
  deadlineAt: Date;
  completedAt: Date | null;
  problems: TodayProblemDto[];
}

export interface TodayResponse {
  phase: Phase;
  serverTime: Date;
  commitment: CommitmentDto;
  today: TodayDto | null;
}

export interface ProgressDayDto {
  date: string;
  dayNumber: number;
  status: DayStatus;
  requiredProblems: number;
  completedProblems: number;
  isToday: boolean;
  isUpcoming: boolean;
  /** The plan's full problem list is already visible before committing, so there's nothing to hide
   *  by including upcoming days here too — it just lets the client show the whole roadmap and gate
   *  interaction (not visibility) on the day arriving. */
  problems: TodayProblemDto[];
}

export interface ProgressResponse {
  serverTime: Date;
  commitment: CommitmentDto;
  days: ProgressDayDto[];
}

const requireSchedule = (commitment: ICommitment): { startDate: string; endDate: string } => {
  if (!commitment.startDate || !commitment.endDate) {
    throw ApiError.internal('COMMITMENT_SCHEDULE_MISSING', 'Commitment has no schedule');
  }
  return { startDate: commitment.startDate, endDate: commitment.endDate };
};

const findDay = async (commitment: ICommitment, date: string): Promise<IDailyProgress> => {
  const progress = await DailyProgress.findOne({ commitmentId: commitment._id, date });
  if (!progress) throw ApiError.internal('PROGRESS_NOT_FOUND', 'Daily progress record is missing');
  return progress;
};

/** insertMany({ ordered: false }) reports duplicate-key conflicts as a bulk error but still inserts
 *  every non-conflicting row. True only if *every* failure was a duplicate key, so a genuine error
 *  alongside duplicates still surfaces. Verified against the driver: `writeErrors` is an array of
 *  `{ err, index }` objects, with the server's error code at `err.code` (not `code`). */
const isDuplicateInsertError = (error: unknown): boolean => {
  type WriteErrorLike = { err?: { code?: number }; code?: number };
  const { writeErrors, code } = (error ?? {}) as { writeErrors?: unknown; code?: number };
  if (writeErrors === undefined) return code === 11000;
  const list = (Array.isArray(writeErrors) ? writeErrors : [writeErrors]) as WriteErrorLike[];
  return list.length > 0 && list.every((e) => (e.err?.code ?? e.code) === 11000);
};

export class DailyProgressService {
  /** Creates one record per commitment day. Idempotent, so a retried activation is safe. */
  static async materialize(
    commitment: ICommitment,
    startDate: string,
    problemIds: Types.ObjectId[]
  ): Promise<void> {
    const perDay = commitment.dailyTarget;
    const operations = Array.from({ length: commitment.durationDays }, (_, index) => {
      const dayProblemIds = problemIds.slice(index * perDay, (index + 1) * perDay);
      return {
        updateOne: {
          filter: {
            userId: commitment.userId,
            commitmentId: commitment._id,
            date: addDays(startDate, index),
          },
          update: {
            $set: {
              dayNumber: index + 1,
              problemIds: dayProblemIds,
              // durationDays is ceil(totalProblems / dailyTarget), so the final day can end up
              // with fewer than dailyTarget problems left over — require only what's actually
              // assigned, or that day would be impossible to complete.
              requiredProblems: dayProblemIds.length,
            },
            $setOnInsert: {
              status: 'PENDING' as const,
              completedProblems: 0,
              problemCompletions: [],
              completedAt: null,
            },
          },
          upsert: true,
        },
      };
    });
    await DailyProgress.bulkWrite(operations);
  }

  /**
   * Marks every unfinished day before today as MISSED, writes a FORFEITURE ledger row for each
   * one, and recomputes everything derived from the day list — streaks, protected/forfeited
   * amounts, and (once the last day is decided) the commitment's final COMPLETED/FAILED status.
   * Idempotent, and updates the passed document in place. Runs on every read/write so no
   * scheduler is needed for correctness.
   */
  static async reconcile(commitment: ICommitment, now: Date): Promise<void> {
    if (commitment.status !== 'ACTIVE') return;

    const todayKey = dayKeyFor(now, commitment.timezone);
    const overdue = await DailyProgress.find({
      commitmentId: commitment._id,
      status: 'PENDING',
      date: { $lt: todayKey },
    });

    // Verified-account users get a short grace after the deadline for the LeetCode verifier to
    // catch up (see env LEETCODE_GRACE_*). A day is only held back while it still has LeetCode
    // problems to check, and never past the hard cap — provider trouble can delay a MISSED, not
    // cause one.
    let newlyMissed = overdue;
    if (overdue.length > 0) {
      const user = await User.findById(commitment.userId).select(
        'leetcodeUsername leetcodeVerifiedAt'
      );
      if (user && hasVerifiedLeetCode(user)) {
        newlyMissed = [];
        for (const day of overdue) {
          if (!(await isInVerificationGrace(day, commitment.timezone, now))) newlyMissed.push(day);
        }
      }
    }

    // Step 1 — claim. Each day flips PENDING -> MISSED atomically, flagged as not yet recorded in the
    // ledger. Only the caller that wins the flip proceeds as the claimant, so two concurrent
    // reconciles never both decide the same day.
    for (const day of newlyMissed) {
      await DailyProgress.updateOne(
        { _id: day._id, status: 'PENDING' },
        { $set: { status: 'MISSED', forfeitureLogged: false } }
      );
    }

    const rows = await DailyProgress.find({ commitmentId: commitment._id })
      .sort({ dayNumber: 1 })
      .select('status');

    let completedDays = 0;
    let missedDays = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    for (const row of rows) {
      if (row.status === 'COMPLETED') {
        completedDays += 1;
        currentStreak += 1;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else if (row.status === 'MISSED') {
        missedDays += 1;
        currentStreak = 0;
      }
      // PENDING (today or a day still ahead) hasn't been decided yet — it neither extends nor
      // breaks the streak.
    }

    // Forfeiture is a fixed percentage of the *original* deposit per missed day, capped at the
    // full deposit — never more than 100% forfeited. currentProtectedAmount doubles as the
    // "eligible refund" figure shown to the user, both mid-challenge and after it finalizes.
    const perMissedDay = Math.round(
      (commitment.depositAmount * commitment.rules.forfeiturePerMissedDay) / 100
    );
    const currentForfeitedAmount = Math.min(commitment.depositAmount, missedDays * perMissedDay);
    const currentProtectedAmount = commitment.depositAmount - currentForfeitedAmount;

    // The commitment is decided the moment its final day stops being PENDING — no need to wait
    // for the calendar end date once that's already happened.
    const lastDayDecided = rows.length > 0 && rows[rows.length - 1].status !== 'PENDING';
    const status: CommitmentStatus = lastDayDecided
      ? missedDays === 0
        ? 'COMPLETED'
        : 'FAILED'
      : commitment.status;

    // Step 2 — record. Every MISSED day not yet in the ledger (just claimed here, or left by a run
    // that crashed between claim and record) gets its FORFEITURE row. The unique one-per-day index
    // makes this safe to repeat and to race: a duplicate insert is simply ignored. The flag is only
    // cleared once the row exists, so a crash at any point is repaired by the next reconcile.
    const unlogged = await DailyProgress.find({
      commitmentId: commitment._id,
      status: 'MISSED',
      forfeitureLogged: false,
    }).select('date');
    if (unlogged.length > 0) {
      try {
        await CommitmentTransaction.insertMany(
          unlogged.map((d) => ({
            userId: commitment.userId,
            commitmentId: commitment._id,
            type: 'FORFEITURE' as const,
            amount: perMissedDay,
            status: 'SUCCESS' as const,
            reference: `Missed day ${d.date}`,
            dayKey: d.date,
          })),
          { ordered: false }
        );
      } catch (error) {
        if (!isDuplicateInsertError(error)) throw error;
      }
      await DailyProgress.updateMany(
        { _id: { $in: unlogged.map((d) => d._id) } },
        { $set: { forfeitureLogged: true } }
      );
    }

    const changed =
      completedDays !== commitment.completedDays ||
      missedDays !== commitment.missedDays ||
      currentStreak !== commitment.currentStreak ||
      longestStreak !== commitment.longestStreak ||
      currentForfeitedAmount !== commitment.currentForfeitedAmount ||
      currentProtectedAmount !== commitment.currentProtectedAmount ||
      status !== commitment.status;

    if (changed) {
      await Commitment.updateOne(
        { _id: commitment._id },
        {
          $set: {
            completedDays,
            missedDays,
            currentStreak,
            longestStreak,
            currentForfeitedAmount,
            currentProtectedAmount,
            status,
          },
        }
      );
      const justFinalized = commitment.status === 'ACTIVE' && status !== 'ACTIVE';
      commitment.completedDays = completedDays;
      commitment.missedDays = missedDays;
      commitment.currentStreak = currentStreak;
      commitment.longestStreak = longestStreak;
      commitment.currentForfeitedAmount = currentForfeitedAmount;
      commitment.currentProtectedAmount = currentProtectedAmount;
      commitment.status = status;

      // Queues the refund ledger row only — never calls Razorpay here. See settlement.service.ts.
      if (justFinalized) await queueRefundIfEligible(commitment);
    }
  }

  static async getToday(
    userId: string,
    commitmentId: string,
    now: Date = new Date()
  ): Promise<TodayResponse> {
    const commitment = await getOwnedCommitment(userId, commitmentId);
    requireActive(commitment);
    await this.reconcile(commitment, now);
    return this.buildToday(commitment, now);
  }

  static async setProblemCompletion(
    userId: string,
    commitmentId: string,
    input: { problemId: string; completed: boolean },
    now: Date = new Date()
  ): Promise<TodayResponse> {
    const { commitment, progress } = await this.loadDayForWrite(userId, commitmentId, now);
    if (progress.status !== 'PENDING') {
      throw ApiError.conflict('DAY_ALREADY_COMPLETED', "Today's commitment is already complete.");
    }

    const problemId = new Types.ObjectId(input.problemId);
    if (!progress.problemIds.some((id) => id.equals(problemId))) {
      throw ApiError.badRequest(
        'PROBLEM_NOT_ASSIGNED',
        "That problem isn't part of today's commitment."
      );
    }

    // Single-document atomic updates keep concurrent taps from losing or duplicating entries.
    if (input.completed) {
      // Judge-enabled problems can only be checked off by an accepted code submission — the
      // manual tick is disabled for them so "no cheating" holds for every problem we judge.
      const problem = await Problem.findById(problemId);
      if (problem?.judgeEnabled) {
        throw ApiError.badRequest(
          'JUDGE_REQUIRED',
          'This problem needs a passing code submission — open it and submit your solution.'
        );
      }
      // With a verified LeetCode account, LeetCode problems are checked off only by a matching
      // Accepted submission. (Commitments started before verification was required, with no
      // verified account, keep the manual tick.)
      if (problem?.source === 'LeetCode') {
        const user = await User.findById(userId).select('leetcodeUsername leetcodeVerifiedAt');
        if (user && hasVerifiedLeetCode(user)) {
          throw ApiError.badRequest(
            'LEETCODE_VERIFICATION_ONLY',
            'This problem is checked off automatically once your Accepted submission is found — use Check submission.'
          );
        }
      }
      await this.recordCompletion(progress._id, problemId, 'SELF_REPORTED', now);
    } else {
      await DailyProgress.updateOne({ _id: progress._id, status: 'PENDING' }, [
        {
          $set: {
            problemCompletions: {
              $filter: {
                input: '$problemCompletions',
                as: 'completion',
                // Only a manual tick can be taken back; completions proven by Judge0 or a LeetCode
                // submission are evidence and stay.
                cond: {
                  $or: [
                    { $ne: ['$$completion.problemId', problemId] },
                    { $ne: ['$$completion.method', 'SELF_REPORTED'] },
                  ],
                },
              },
            },
          },
        },
        { $set: { completedProblems: { $size: '$problemCompletions' } } },
      ]);
    }

    return this.buildToday(commitment, now);
  }

  static async completeDay(
    userId: string,
    commitmentId: string,
    now: Date = new Date()
  ): Promise<TodayResponse> {
    const { commitment, progress } = await this.loadDayForWrite(userId, commitmentId, now);
    if (progress.status === 'COMPLETED') return this.buildToday(commitment, now);

    const verification = await completionVerification.verifyDailyCompletion(progress);
    if (!verification.verified) {
      throw ApiError.badRequest(
        'DAY_INCOMPLETE',
        verification.reason ?? "Complete all of today's problems first."
      );
    }

    const result = await DailyProgress.updateOne(
      {
        _id: progress._id,
        status: 'PENDING',
        completedProblems: { $gte: progress.requiredProblems },
      },
      { $set: { status: 'COMPLETED', completedAt: now } }
    );

    if (result.modifiedCount === 0) {
      const latest = await findDay(commitment, progress.date);
      if (latest.status !== 'COMPLETED') {
        throw ApiError.conflict(
          'DAY_UPDATE_CONFLICT',
          "Your progress changed. Review today's problems and try again."
        );
      }
    }

    await this.reconcile(commitment, now);
    return this.buildToday(commitment, now);
  }

  /** Completes a PENDING day (today's, or one still in its verification grace) once every assigned
   *  problem is checked off, then recomputes streaks/attendance through reconcile(). Idempotent.
   *  Returns whether the day is COMPLETED. */
  static async finalizeDay(
    commitment: ICommitment,
    progress: IDailyProgress,
    now: Date
  ): Promise<boolean> {
    if (progress.status === 'COMPLETED') return true;
    const verification = await completionVerification.verifyDailyCompletion(progress);
    if (!verification.verified) return false;

    // Stamped with the last solve, not "now": a day finalized in its grace period was still
    // completed inside the day.
    const completedAt = new Date(
      Math.max(...progress.problemCompletions.map((c) => c.completedAt.getTime()))
    );
    await DailyProgress.updateOne(
      {
        _id: progress._id,
        status: 'PENDING',
        completedProblems: { $gte: progress.requiredProblems },
      },
      { $set: { status: 'COMPLETED', completedAt } }
    );
    await this.reconcile(commitment, now);
    return (await DailyProgress.exists({ _id: progress._id, status: 'COMPLETED' })) !== null;
  }

  static async getProgress(
    userId: string,
    commitmentId: string,
    now: Date = new Date()
  ): Promise<ProgressResponse> {
    const commitment = await getOwnedCommitment(userId, commitmentId);
    if (commitment.status === 'PENDING_PAYMENT') {
      throw ApiError.conflict('COMMITMENT_NOT_ACTIVE', 'This commitment is not active.');
    }
    await this.reconcile(commitment, now);

    const todayKey = dayKeyFor(now, commitment.timezone);
    const rows = await DailyProgress.find({ commitmentId: commitment._id }).sort({ dayNumber: 1 });

    const allProblemIds = rows.flatMap((row) => row.problemIds);
    const problems = await Problem.find({ _id: { $in: allProblemIds } });
    const byId = new Map(problems.map((p) => [p._id.toString(), p]));

    return {
      serverTime: now,
      commitment: toCommitmentDto(commitment),
      days: rows.map((row) => {
        const completedAtById = new Map(
          row.problemCompletions.map((c) => [c.problemId.toString(), c.completedAt])
        );
        const methodById = new Map(
          row.problemCompletions.map((c) => [c.problemId.toString(), c.method])
        );
        const dayProblems: TodayProblemDto[] = [];
        for (const id of row.problemIds) {
          const problem = byId.get(id.toString());
          if (!problem) continue;
          const completedAt = completedAtById.get(id.toString()) ?? null;
          dayProblems.push({
            ...toProblemDto(problem),
            completed: completedAt !== null,
            completedAt,
            completionMethod: methodById.get(id.toString()) ?? null,
          });
        }

        return {
          date: row.date,
          dayNumber: row.dayNumber,
          status: row.status,
          requiredProblems: row.requiredProblems,
          completedProblems: row.completedProblems,
          isToday: row.date === todayKey,
          isUpcoming: row.date > todayKey,
          problems: dayProblems,
        };
      }),
    };
  }

  /** Marks a problem complete via an atomic, idempotent single-document update — shared by the
   *  self-reported checkbox above, SubmissionService's accepted-submission path, and
   *  LeetCodeVerificationService's matched-submission path. `extra` carries whatever
   *  method-specific evidence that completion method records (a Submission ref for Judge0, a
   *  LeetCode evidence snapshot for LeetCode). */
  private static async recordCompletion(
    progressId: Types.ObjectId,
    problemId: Types.ObjectId,
    method: CompletionMethod,
    now: Date,
    extra: { submissionId?: Types.ObjectId; leetcodeEvidence?: ILeetCodeEvidence } = {}
  ): Promise<void> {
    await DailyProgress.updateOne(
      {
        _id: progressId,
        status: 'PENDING',
        'problemCompletions.problemId': { $ne: problemId },
      },
      [
        {
          $set: {
            problemCompletions: {
              $concatArrays: [
                '$problemCompletions',
                [{ problemId, completedAt: now, method, ...extra }],
              ],
            },
          },
        },
        { $set: { completedProblems: { $size: '$problemCompletions' } } },
      ]
    );
  }

  /** The only way a judge-enabled problem is checked off — called by SubmissionService once
   *  Judge0 has accepted a submission against every one of that problem's test cases. */
  static async recordJudgeCompletion(
    progressId: Types.ObjectId,
    problemId: Types.ObjectId,
    submissionId: Types.ObjectId,
    now: Date
  ): Promise<void> {
    await this.recordCompletion(progressId, problemId, 'JUDGE0', now, { submissionId });
  }

  /** Called by LeetCodeVerificationService once a matching Accepted submission is found on the
   *  user's connected LeetCode account, inside today's window. */
  static async recordLeetCodeCompletion(
    progressId: Types.ObjectId,
    problemId: Types.ObjectId,
    evidence: ILeetCodeEvidence,
    now: Date
  ): Promise<void> {
    await this.recordCompletion(progressId, problemId, 'LEETCODE', now, {
      leetcodeEvidence: evidence,
    });
  }

  /** Loads (and reconciles) the commitment's writable "today" row. Shared with SubmissionService
   *  so code runs/submissions validate against the same active-day rules as the checkbox does. */
  static async loadDayForWrite(
    userId: string,
    commitmentId: string,
    now: Date
  ): Promise<{ commitment: ICommitment; progress: IDailyProgress }> {
    const commitment = await getOwnedCommitment(userId, commitmentId);
    requireActive(commitment);
    await this.reconcile(commitment, now);

    const { startDate, endDate } = requireSchedule(commitment);
    const todayKey = dayKeyFor(now, commitment.timezone);
    if (todayKey < startDate || todayKey > endDate) {
      throw ApiError.conflict('NO_ACTIVE_DAY', 'There is no commitment day to update right now.');
    }

    return { commitment, progress: await findDay(commitment, todayKey) };
  }

  private static async buildToday(commitment: ICommitment, now: Date): Promise<TodayResponse> {
    const { startDate, endDate } = requireSchedule(commitment);
    const todayKey = dayKeyFor(now, commitment.timezone);
    const phase: Phase =
      todayKey < startDate ? 'NOT_STARTED' : todayKey > endDate ? 'ENDED' : 'IN_PROGRESS';

    const base = { phase, serverTime: now, commitment: toCommitmentDto(commitment) };
    if (phase !== 'IN_PROGRESS') return { ...base, today: null };

    const progress = await findDay(commitment, todayKey);
    const problems = await Problem.find({ _id: { $in: progress.problemIds } });
    const byId = new Map(problems.map((p) => [p._id.toString(), p]));
    const completedAtById = new Map(
      progress.problemCompletions.map((c) => [c.problemId.toString(), c.completedAt])
    );
    const methodById = new Map(
      progress.problemCompletions.map((c) => [c.problemId.toString(), c.method])
    );

    const items: TodayProblemDto[] = [];
    for (const id of progress.problemIds) {
      const problem = byId.get(id.toString());
      if (!problem) continue;
      const completedAt = completedAtById.get(id.toString()) ?? null;
      items.push({
        ...toProblemDto(problem),
        completed: completedAt !== null,
        completedAt,
        completionMethod: methodById.get(id.toString()) ?? null,
      });
    }

    return {
      ...base,
      today: {
        date: progress.date,
        dayNumber: progress.dayNumber,
        status: progress.status,
        requiredProblems: progress.requiredProblems,
        completedProblems: progress.completedProblems,
        deadlineAt: endOfDay(progress.date, commitment.timezone),
        completedAt: progress.completedAt,
        problems: items,
      },
    };
  }
}
