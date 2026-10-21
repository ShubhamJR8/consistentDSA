import { Commitment } from '../models/commitment.model.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';

/**
 * Finalizes commitments whose last day has passed even if nobody ever opens the app again —
 * reconcile() otherwise only runs lazily, on a read/write for that specific commitment. This job
 * only ever moves status ACTIVE -> COMPLETED/FAILED and queues the resulting refund row (see
 * settlement.service.ts); it never calls Razorpay, so it's safe to run unconditionally and
 * frequently. Real money is only ever moved by the manually-run scripts/refunds.ts.
 */
export const runCommitmentSettlementSweep = async (now: Date = new Date()): Promise<void> => {
  const commitments = await Commitment.find({ status: 'ACTIVE' });

  for (const commitment of commitments) {
    try {
      await DailyProgressService.reconcile(commitment, now);
    } catch (error) {
      console.error('[CommitmentSettlement] sweep step failed', {
        commitment: commitment._id.toString(),
        error,
      });
    }
  }
};

let timer: ReturnType<typeof setInterval> | null = null;

export const startCommitmentSettlementJob = (intervalMinutes: number): void => {
  if (timer) return;
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;
  timer = setInterval(() => {
    void runCommitmentSettlementSweep();
  }, intervalMs);
  timer.unref();
};

export const stopCommitmentSettlementJob = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
