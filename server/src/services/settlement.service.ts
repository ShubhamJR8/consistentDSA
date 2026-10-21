import { ICommitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { isDuplicateKeyError } from '../utils/mongo.js';

/**
 * Queues (never executes) the refund owed to a commitment the moment it finalizes into
 * COMPLETED/FAILED. Refund *execution* is a deliberately separate, manually-run step (see
 * scripts/refunds.ts) — this only writes the PENDING ledger row so it's ready to be checked and
 * triggered by hand. Real money never moves from here.
 *
 * Idempotent: the partial unique index on (commitmentId, type: REFUND) means a second call (e.g.
 * a race between two concurrent reconcile() calls) is a harmless no-op.
 */
export const queueRefundIfEligible = async (commitment: ICommitment): Promise<void> => {
  if (commitment.currentProtectedAmount <= 0) return;

  const deposit = await CommitmentTransaction.findOne({
    commitmentId: commitment._id,
    type: 'DEPOSIT',
    status: 'SUCCESS',
  }).sort({ createdAt: -1 });
  if (!deposit?.razorpayPaymentId) return;

  try {
    await CommitmentTransaction.create({
      userId: commitment.userId,
      commitmentId: commitment._id,
      type: 'REFUND',
      amount: commitment.currentProtectedAmount,
      status: 'PENDING',
      reference: 'Awaiting manual verification and refund execution',
      razorpayPaymentId: deposit.razorpayPaymentId,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
};
