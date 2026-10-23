import { RazorpayRefund } from '../integrations/razorpay/razorpay.client.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';

// Real money moves here, and only from the manually-run scripts/refunds.ts. The one thing that must
// never happen is refunding the same ledger row twice, which a naive "call Razorpay, then save"
// does if the process dies (or the network drops) in between. So:
//   1. the row is claimed PENDING -> PROCESSING *before* the call, so two runs can't both start;
//   2. every refund carries notes.transactionId, and before issuing one we look for an existing
//      refund with that id (the refund.processed webhook reconciles the same way);
//   3. an unknown outcome (timeout, 5xx, crash) leaves the row PROCESSING instead of FAILED — it is
//      safe to re-run `execute`, which repeats step 2 first. Only a definite 4xx rejection is FAILED.

export interface RefundGateway {
  refund(paymentId: string, amountPaise: number, transactionId: string): Promise<RazorpayRefund>;
  findRefundForTransaction(
    paymentId: string,
    transactionId: string
  ): Promise<RazorpayRefund | null>;
}

export type RefundExecutionCode =
  'EXECUTED' | 'ADOPTED_EXISTING' | 'REFUSED' | 'REJECTED' | 'UNKNOWN_OUTCOME';

export interface RefundExecutionResult {
  ok: boolean;
  code: RefundExecutionCode;
  message: string;
  refundId?: string;
}

const refused = (message: string): RefundExecutionResult => ({
  ok: false,
  code: 'REFUSED',
  message,
});

/** True for a response in which Razorpay definitely declined (so nothing was refunded). */
const isDefiniteRejection = (error: unknown): boolean => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
};

const describe = (error: unknown): string => {
  const detail = (error as { error?: { description?: string } } | null)?.error?.description;
  return detail ?? (error instanceof Error ? error.message : String(error));
};

export const executeRefund = async (
  transactionId: string,
  gateway: RefundGateway
): Promise<RefundExecutionResult> => {
  const tx = await CommitmentTransaction.findById(transactionId);
  if (!tx) return refused(`No transaction found with id ${transactionId}.`);
  if (tx.type !== 'REFUND' || (tx.status !== 'PENDING' && tx.status !== 'PROCESSING')) {
    return refused(
      `Transaction ${transactionId} is not an open refund (type=${tx.type}, status=${tx.status}).`
    );
  }
  if (!tx.razorpayPaymentId) {
    return refused(`Transaction ${transactionId} has no original payment id to refund against.`);
  }

  // A payment under dispute is already being clawed back by the card network; refunding it as well
  // would pay the customer twice.
  const disputed = await CommitmentTransaction.findOne({
    type: 'DEPOSIT',
    razorpayPaymentId: tx.razorpayPaymentId,
    disputeStatus: { $exists: true, $nin: ['won'] },
  });
  if (disputed) {
    return refused(
      `Payment ${tx.razorpayPaymentId} has a dispute (${disputed.disputeStatus}); refusing to refund it.`
    );
  }

  // Re-check against the commitment's current numbers right before calling Razorpay — catches the
  // rare case where something changed between `list` and `execute`.
  const commitment = await Commitment.findById(tx.commitmentId);
  const reason = tx.refundReason ?? 'SETTLEMENT';
  if (reason === 'SETTLEMENT') {
    if (!commitment || !['COMPLETED', 'FAILED'].includes(commitment.status)) {
      return refused(`Commitment ${tx.commitmentId.toString()} is not in a finalized state.`);
    }
    if (commitment.currentProtectedAmount !== tx.amount) {
      return refused(
        `Amount mismatch: transaction says ₹${tx.amount}, commitment.currentProtectedAmount is ₹${commitment.currentProtectedAmount}. Refusing to proceed.`
      );
    }
  } else if (reason === 'UNACTIVATABLE' && commitment?.status !== 'CANCELLED') {
    // A full-deposit refund is only right for a commitment that never started.
    return refused(
      `Commitment ${tx.commitmentId.toString()} is not cancelled; refusing a full refund.`
    );
  }
  // DUPLICATE_PAYMENT: the whole extra payment goes back whatever state the commitment is in.

  if (tx.status === 'PENDING') {
    const claimed = await CommitmentTransaction.findOneAndUpdate(
      { _id: tx._id, status: 'PENDING' },
      { $set: { status: 'PROCESSING', reference: 'Refund in progress' } }
    );
    if (!claimed) return refused('Another run already claimed this refund.');
  }

  const complete = async (
    refund: RazorpayRefund,
    code: 'EXECUTED' | 'ADOPTED_EXISTING'
  ): Promise<RefundExecutionResult> => {
    await CommitmentTransaction.updateOne(
      { _id: tx._id },
      {
        $set: {
          status: 'SUCCESS',
          razorpayRefundId: refund.id,
          reference: 'Refund executed via manual script',
        },
      }
    );
    return { ok: true, code, refundId: refund.id, message: `Razorpay refund id: ${refund.id}` };
  };

  const unknown = (what: string, error: unknown): RefundExecutionResult => ({
    ok: false,
    code: 'UNKNOWN_OUTCOME',
    message: `${what}: ${describe(error)}. The refund may or may not have happened; the row stays PROCESSING. Check the Razorpay dashboard, then re-run execute — it looks for an existing refund before issuing one.`,
  });

  let existing: RazorpayRefund | null;
  try {
    existing = await gateway.findRefundForTransaction(tx.razorpayPaymentId, tx._id.toString());
  } catch (error) {
    return unknown('Could not check Razorpay for an existing refund', error);
  }
  if (existing) return complete(existing, 'ADOPTED_EXISTING');

  try {
    const refund = await gateway.refund(tx.razorpayPaymentId, tx.amount * 100, tx._id.toString());
    return await complete(refund, 'EXECUTED');
  } catch (error) {
    if (isDefiniteRejection(error)) {
      await CommitmentTransaction.updateOne(
        { _id: tx._id },
        { $set: { status: 'FAILED', reference: `Refund rejected: ${describe(error)}` } }
      );
      return {
        ok: false,
        code: 'REJECTED',
        message: `Razorpay rejected the refund: ${describe(error)}`,
      };
    }
    return unknown('Refund call failed', error);
  }
};
