import { Commitment } from '../models/commitment.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { User } from '../models/user.model.js';
import { LeetCodeVerificationService } from '../services/leetcodeVerification.service.js';

/**
 * One sweep: every active commitment belonging to a user with a connected LeetCode username, that
 * still has a pending day sitting around, gets re-checked. A plain exported async function rather
 * than anything queue-shaped on purpose — this is the "simple service abstraction" the LeetCode
 * verification MVP calls for; swap the setInterval driver below for BullMQ/Redis later without
 * touching this function.
 */
export const runLeetCodeVerificationSweep = async (now: Date = new Date()): Promise<void> => {
  const connectedUserIds = (await User.find({ leetcodeUsername: { $ne: null } }).select('_id')).map(
    (u) => u._id
  );
  if (connectedUserIds.length === 0) return;

  const commitments = await Commitment.find({ status: 'ACTIVE', userId: { $in: connectedUserIds } });

  for (const commitment of commitments) {
    const hasPendingDay = await DailyProgress.exists({
      commitmentId: commitment._id,
      status: 'PENDING',
    });
    if (!hasPendingDay) continue;

    try {
      await LeetCodeVerificationService.verifyToday(
        commitment.userId.toString(),
        commitment._id.toString(),
        now
      );
    } catch (error) {
      // A single commitment failing (e.g. it's between days right now) shouldn't stop the sweep.
      console.error('[LeetCodeVerification] sweep step failed', {
        commitment: commitment._id.toString(),
        error,
      });
    }
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
