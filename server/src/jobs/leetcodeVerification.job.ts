import { Commitment } from '../models/commitment.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { User } from '../models/user.model.js';
import { addDays, dayKeyFor } from '../utils/localDate.js';
import { LeetCodeVerificationService } from '../services/leetcodeVerification.service.js';

// Politeness delay between users so a sweep never bursts at the (unofficial) provider.
const DELAY_BETWEEN_USERS_MS = 300;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let sweeping = false;

/**
 * One sweep: every ACTIVE commitment whose owner has a *verified* LeetCode account and whose
 * current day still has unchecked problems gets re-verified. A plain exported async function rather
 * than anything queue-shaped on purpose, so it can be driven by the in-process timer below, a
 * dedicated worker process, or a managed cron job — swap the driver, not this function.
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

    for (const commitment of commitments) {
      const todayKey = dayKeyFor(now, commitment.timezone);
      // Today, plus the previous day while it's still inside its verification grace window.
      const hasUnfinishedDay = await DailyProgress.exists({
        commitmentId: commitment._id,
        status: 'PENDING',
        date: { $lte: todayKey, $gte: addDays(todayKey, -1) },
      });
      if (!hasUnfinishedDay) continue;

      try {
        const userId = commitment.userId.toString();
        const commitmentId = commitment._id.toString();
        await LeetCodeVerificationService.verifyGraceDays(userId, commitmentId, now);
        await LeetCodeVerificationService.verifyToday(userId, commitmentId, now);
      } catch (error) {
        // One commitment failing (e.g. it's between days right now) shouldn't stop the sweep. Log
        // only identifiers and the message — never the full error object, which may carry request
        // details.
        console.error('[LeetCodeVerification] sweep step failed', {
          commitment: commitment._id.toString(),
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
      await sleep(DELAY_BETWEEN_USERS_MS);
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
