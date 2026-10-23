import { Commitment } from '../models/commitment.model.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import { queueMissingRefunds } from '../services/settlement.service.js';
import { withLease } from '../utils/jobLease.js';
import { describeError, logger } from '../utils/logger.js';

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
      logger.error('commitment_settlement_step_failed', {
        commitment: commitment._id.toString(),
        ...describeError(error),
      });
    }
  }

  // After reconciling: catch any commitment that finalized but never had its refund queued.
  try {
    const queued = await queueMissingRefunds();
    if (queued > 0) logger.warn('refunds_queued_by_repair', { count: queued });
  } catch (error) {
    logger.error('refund_repair_failed', describeError(error));
  }
};

let timer: ReturnType<typeof setInterval> | null = null;

export const startCommitmentSettlementJob = (intervalMinutes: number): void => {
  if (timer) return;
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;
  timer = setInterval(() => {
    void withLease('commitment-settlement-sweep', Math.max(2 * intervalMs, 5 * 60_000), () =>
      runCommitmentSettlementSweep()
    );
  }, intervalMs);
  timer.unref();
};

export const stopCommitmentSettlementJob = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
