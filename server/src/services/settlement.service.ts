import { Commitment, ICommitment } from '../models/commitment.model.js';
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
      refundReason: 'SETTLEMENT',
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
};

/**
 * Repairs the one gap reconcile() cannot: a commitment that was finalized but whose process died
 * before queueRefundIfEligible ran. reconcile() skips non-ACTIVE commitments, so without this the
 * refund owed to the user would simply never be recorded. Finds finalized commitments that still hold
 * money, have a captured deposit, and no REFUND row yet, and queues them (idempotent per payment).
 * Returns how many it queued.
 */
export const queueMissingRefunds = async (limit = 200): Promise<number> => {
  const transactions = CommitmentTransaction.collection.name;
  const candidates = await Commitment.aggregate<{ _id: ICommitment['_id'] }>([
    { $match: { status: { $in: ['COMPLETED', 'FAILED'] }, currentProtectedAmount: { $gt: 0 } } },
    {
      $lookup: {
        from: transactions,
        let: { id: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$commitmentId', '$$id'] }, type: 'REFUND' } },
          { $limit: 1 },
        ],
        as: 'refunds',
      },
    },
    { $match: { refunds: { $size: 0 } } },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]);

  let queued = 0;
  for (const { _id } of candidates) {
    const commitment = await Commitment.findById(_id);
    if (!commitment) continue;
    await queueRefundIfEligible(commitment);
    if (await CommitmentTransaction.exists({ commitmentId: _id, type: 'REFUND' })) queued += 1;
  }
  return queued;
};
