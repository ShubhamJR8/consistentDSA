import { Commitment } from '../models/commitment.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { User } from '../models/user.model.js';
import { env } from '../config/env.js';
import { getLeetCodeProviderStatus } from '../integrations/leetcode/leetcode.client.js';
import { logger } from '../utils/logger.js';
import { addDays, dayKeyFor, endOfDay } from '../utils/localDate.js';
import { LeetCodeVerificationService } from '../services/leetcodeVerification.service.js';

// Politeness delay between users so a sweep never bursts at the (unofficial) provider.
const DELAY_BETWEEN_USERS_MS = 300;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let sweeping = false;

// A provider that has been failing this long is an outage worth waking someone for (users' days are
// being held open, not penalised, but nothing is being verified).
const OUTAGE_ALERT_AFTER_MS = 15 * 60_000;

/**
 * One sweep: every ACTIVE commitment whose owner has a *verified* LeetCode account and which still
 * has an unfinished day gets re-verified. A plain exported async function rather than anything
 * queue-shaped on purpose, so it can be driven by the in-process timer below, a dedicated worker
 * process, or a managed cron job — swap the driver, not this function.
 *
 * Most urgent first: days already past their deadline (inside grace, where a MISSED is about to be
 * decided) before days still running. When the provider budget runs low, only the former are checked
 * so the remainder stays available for users clicking "Check submission". A day is never skipped in a
 * way that could get it marked missed unchecked — see verificationGraceEnd.
 *
 * Overlap guard is per process. Running several server instances at once is still safe (every write
 * is an atomic, idempotent update), just wasteful; run the sweep from a single instance.
 */
export const runLeetCodeVerificationSweep = async (now: Date = new Date()): Promise<void> => {
  if (sweeping) return;
  sweeping = true;
  try {
    const connectedUserIds = (
      await User.find({
        leetcodeUsername: { $ne: null },
        leetcodeVerifiedAt: { $ne: null },
      }).select('_id')
    ).map((u) => u._id);
    if (connectedUserIds.length === 0) return;

    const commitments = await Commitment.find({
      status: 'ACTIVE',
      userId: { $in: connectedUserIds },
    });

    // Held days can be older than yesterday (a long outage), so look back as far as they can be held.
    const lookbackDays = Math.ceil(env.LEETCODE_GRACE_PROVIDER_DOWN_MAX_HOURS / 24) + 1;
    const work: Array<{
      commitment: (typeof commitments)[number];
      deadline: number;
      late: boolean;
    }> = [];
    for (const commitment of commitments) {
      const todayKey = dayKeyFor(now, commitment.timezone);
      const oldest = await DailyProgress.findOne({
        commitmentId: commitment._id,
        status: 'PENDING',
        date: { $lte: todayKey, $gte: addDays(todayKey, -lookbackDays) },
      })
        .sort({ date: 1 })
        .select('date');
      if (!oldest) continue;
      work.push({
        commitment,
        deadline: endOfDay(oldest.date, commitment.timezone).getTime(),
        late: oldest.date < todayKey,
      });
    }
    work.sort((a, b) => a.deadline - b.deadline);

    const reserve = (env.LEETCODE_API_HOURLY_BUDGET * env.LEETCODE_SWEEP_RESERVE_PERCENT) / 100;
    let deferred = 0;
    for (const { commitment, late } of work) {
      const { budget } = getLeetCodeProviderStatus();
      if (!late && budget.limit > 0 && budget.remaining <= reserve) {
        deferred += 1;
        continue;
      }

      try {
        const userId = commitment.userId.toString();
        const commitmentId = commitment._id.toString();
        await LeetCodeVerificationService.verifyGraceDays(userId, commitmentId, now);
        await LeetCodeVerificationService.verifyToday(userId, commitmentId, now);
      } catch (error) {
        // One commitment failing (e.g. it's between days right now) shouldn't stop the sweep. Log
        // only identifiers and the message — never the full error object, which may carry request
        // details.
        logger.error('leetcode_sweep_step_failed', {
          commitment: commitment._id.toString(),
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
      await sleep(DELAY_BETWEEN_USERS_MS);
    }

    const status = getLeetCodeProviderStatus();
    if (deferred > 0) {
      logger.warn('leetcode_sweep_deferred', {
        deferred,
        budgetRemaining: status.budget.remaining,
        budgetLimit: status.budget.limit,
      });
    }
    if (
      status.failingSince &&
      now.getTime() - status.failingSince.getTime() >= OUTAGE_ALERT_AFTER_MS
    ) {
      logger.alert('leetcode_provider_down', {
        failingSince: status.failingSince.toISOString(),
        consecutiveFailures: status.consecutiveFailures,
        lastSuccessAt: status.lastSuccessAt?.toISOString() ?? null,
        note: 'Days are being held open, not marked missed. Verification resumes when the provider recovers.',
      });
    }
  } finally {
    sweeping = false;
  }
};

let timer: ReturnType<typeof setInterval> | null = null;

export const startLeetCodeVerificationJob = (intervalMinutes: number): void => {
  if (timer) return;
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;
  timer = setInterval(() => {
    void runLeetCodeVerificationSweep();
  }, intervalMs);
  timer.unref();
};

export const stopLeetCodeVerificationJob = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
