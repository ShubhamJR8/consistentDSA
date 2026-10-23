import { z } from 'zod';
import { env } from '../config/env.js';
import { verifyWebhookSignature } from '../integrations/razorpay/webhookSignature.js';
import { Commitment } from '../models/commitment.model.js';
import {
  CommitmentTransaction,
  ICommitmentTransaction,
  RefundReason,
} from '../models/commitmentTransaction.model.js';
import { ProcessedWebhookEvent } from '../models/processedWebhookEvent.model.js';
import { ApiError } from '../utils/apiError.js';
import { isDuplicateKeyError, isObjectIdString } from '../utils/mongo.js';
import { CommitmentService } from './commitment.service.js';

// The browser's /payments/verify call is not the only way a captured payment can reach us: a user can
// pay and then lose connectivity or close the tab. Razorpay's server-to-server webhook is the safety
// net — it runs the same idempotent activation, so whichever arrives first wins and the other is a
// no-op. Nothing here moves money; it only records a capture and activates the commitment.

const CAPTURE_EVENTS = new Set(['payment.captured', 'order.paid']);

const envelopeSchema = z.object({ event: z.string(), payload: z.unknown() });

const captureSchema = z.object({
  payment: z.object({
    entity: z.object({
      id: z.string().min(1),
      order_id: z.string().min(1).nullable().optional(),
      amount: z.number(),
    }),
  }),
});

const disputeSchema = z.object({
  dispute: z.object({ entity: z.object({ id: z.string().min(1), payment_id: z.string().min(1) }) }),
});

const refundSchema = z.object({
  refund: z.object({
    entity: z.object({
      id: z.string().min(1),
      notes: z.record(z.unknown()).nullable().optional(),
    }),
  }),
});

export type WebhookOutcome =
  | 'ignored_event'
  | 'duplicate_event'
  | 'unknown_order'
  | 'amount_mismatch'
  | 'activated'
  | 'already_active'
  | 'commitment_not_pending'
  | 'duplicate_refund_queued'
  | 'cancelled_refund_queued'
  | 'dispute_recorded'
  | 'refund_reconciled';

// A dispute only ever moves forward; a delayed "created" must not undo a "won"/"lost" that already
// arrived. Anything that is not a final state is still open.
const FINAL_DISPUTE_STATES = new Set(['won', 'lost', 'closed']);

// Activation failures that retrying can never fix (the plan the commitment was built on is gone or
// too small). Anything else is treated as transient and surfaced so the caller retries.
const PERMANENT_ACTIVATION_ERRORS = new Set(['PLAN_TOO_SMALL', 'PLAN_NOT_FOUND']);

const REFUND_REFERENCE: Record<Exclude<RefundReason, 'SETTLEMENT'>, string> = {
  DUPLICATE_PAYMENT: 'Duplicate payment - awaiting manual refund',
  UNACTIVATABLE: 'Commitment could not start - awaiting manual refund',
};

/** Queues (never executes) a full refund of one payment. Idempotent per payment id. */
const queueFullRefund = async (
  deposit: ICommitmentTransaction,
  paymentId: string,
  reason: Exclude<RefundReason, 'SETTLEMENT'>
): Promise<void> => {
  try {
    await CommitmentTransaction.create({
      userId: deposit.userId,
      commitmentId: deposit.commitmentId,
      type: 'REFUND',
      amount: deposit.amount,
      status: 'PENDING',
      reference: REFUND_REFERENCE[reason],
      razorpayPaymentId: paymentId,
      refundReason: reason,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
};

const log = (line: Record<string, string>): void => {
  const tags = Object.entries(line)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`[PaymentWebhook] ${tags}`);
};

export class PaymentWebhookService {
  static async handle(
    rawBody: Buffer,
    signature: string | undefined,
    eventId?: string,
    now: Date = new Date()
  ): Promise<WebhookOutcome> {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new ApiError(503, 'WEBHOOK_NOT_CONFIGURED', 'Payment webhooks are not enabled.');
    }
    if (!verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET)) {
      throw ApiError.unauthorized('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
    }

    let envelope: z.SafeParseReturnType<unknown, z.infer<typeof envelopeSchema>>;
    try {
      envelope = envelopeSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw ApiError.badRequest('WEBHOOK_PAYLOAD_INVALID', 'Webhook body is not valid JSON.');
    }
    if (!envelope.success) {
      throw ApiError.badRequest('WEBHOOK_PAYLOAD_INVALID', 'Unexpected webhook payload.');
    }

    if (eventId && (await ProcessedWebhookEvent.exists({ eventId }))) return 'duplicate_event';

    const outcome = await this.dispatch(envelope.data.event, envelope.data.payload, now);

    // Only after success: a failed attempt must be retried, not remembered as done.
    if (eventId) {
      await ProcessedWebhookEvent.create({ eventId }).catch((error: unknown) => {
        if (!isDuplicateKeyError(error)) throw error;
      });
    }
    return outcome;
  }

  private static async dispatch(
    event: string,
    payload: unknown,
    now: Date
  ): Promise<WebhookOutcome> {
    if (CAPTURE_EVENTS.has(event)) {
      const parsed = captureSchema.safeParse(payload);
      if (!parsed.success) {
        throw ApiError.badRequest('WEBHOOK_PAYLOAD_INVALID', 'Unexpected webhook payload.');
      }
      const payment = parsed.data.payment.entity;
      if (!payment.order_id) return 'unknown_order';
      return this.applyCapture(
        { id: payment.id, orderId: payment.order_id, amount: payment.amount },
        event,
        now
      );
    }
    if (event.startsWith('payment.dispute.')) return this.recordDispute(event, payload);
    if (event === 'refund.processed' || event === 'refund.failed') {
      return this.reconcileRefund(event, payload);
    }
    return 'ignored_event';
  }

  /** Marks the deposit's payment as disputed (chargeback). Nothing is changed on the commitment — what
   *  to do about a lost dispute is a human call — but the payment can no longer be refunded by us
   *  (see refundExecution.service) and the event is logged loudly so it gets noticed. */
  private static async recordDispute(event: string, payload: unknown): Promise<WebhookOutcome> {
    const parsed = disputeSchema.safeParse(payload);
    if (!parsed.success) {
      throw ApiError.badRequest('WEBHOOK_PAYLOAD_INVALID', 'Unexpected webhook payload.');
    }
    const { id, payment_id: paymentId } = parsed.data.dispute.entity;
    const state = event.slice('payment.dispute.'.length);

    const deposits = await CommitmentTransaction.find({
      type: 'DEPOSIT',
      razorpayPaymentId: paymentId,
    });
    if (deposits.length === 0) {
      log({ event, payment: paymentId, outcome: 'unknown_payment' });
      return 'unknown_order';
    }

    for (const deposit of deposits) {
      const alreadyFinal = deposit.disputeStatus && FINAL_DISPUTE_STATES.has(deposit.disputeStatus);
      if (alreadyFinal && !FINAL_DISPUTE_STATES.has(state)) continue;
      await CommitmentTransaction.updateOne(
        { _id: deposit._id },
        { $set: { disputeId: id, disputeStatus: state } }
      );
      if (state !== 'won') {
        console.error('[PaymentWebhook] DISPUTE needs attention', {
          dispute: id,
          payment: paymentId,
          state,
          commitment: deposit.commitmentId.toString(),
        });
      }
    }
    return 'dispute_recorded';
  }

  /** Brings a refund row in line with what Razorpay says happened. This is what rescues a refund the
   *  manual script issued but crashed before recording, so it is never issued a second time. */
  private static async reconcileRefund(event: string, payload: unknown): Promise<WebhookOutcome> {
    const parsed = refundSchema.safeParse(payload);
    if (!parsed.success) {
      throw ApiError.badRequest('WEBHOOK_PAYLOAD_INVALID', 'Unexpected webhook payload.');
    }
    const { id, notes } = parsed.data.refund.entity;
    const transactionId = notes?.transactionId;
    if (typeof transactionId !== 'string' || !isObjectIdString(transactionId)) {
      return 'ignored_event'; // not a refund this system issued
    }

    if (event === 'refund.processed') {
      const result = await CommitmentTransaction.updateOne(
        {
          _id: transactionId,
          type: 'REFUND',
          status: { $in: ['PENDING', 'PROCESSING', 'FAILED'] },
        },
        {
          $set: {
            status: 'SUCCESS',
            razorpayRefundId: id,
            reference: 'Refund confirmed by Razorpay',
          },
        }
      );
      return result.modifiedCount > 0 ? 'refund_reconciled' : 'ignored_event';
    }

    const result = await CommitmentTransaction.updateOne(
      { _id: transactionId, type: 'REFUND', status: { $in: ['PROCESSING', 'SUCCESS'] } },
      {
        $set: { status: 'FAILED', reference: 'Refund failed at Razorpay - needs manual follow-up' },
      }
    );
    if (result.modifiedCount > 0) {
      console.error('[PaymentWebhook] REFUND FAILED at Razorpay', { refund: id, transactionId });
    }
    return 'refund_reconciled';
  }

  /** Records a captured payment against its deposit row and activates the commitment. Shared by the
   *  webhook and the reconciliation sweep, so both apply exactly the same checks. Idempotent. */
  static async applyCapture(
    payment: { id: string; orderId: string; amount: number },
    source: string,
    now: Date = new Date()
  ): Promise<WebhookOutcome> {
    const transaction = await CommitmentTransaction.findOne({
      type: 'DEPOSIT',
      razorpayOrderId: payment.orderId,
    });
    if (!transaction) {
      log({ source, order: payment.orderId, outcome: 'unknown_order' });
      return 'unknown_order';
    }

    // Razorpay amounts are in paise. A mismatch means this capture is not the deposit we asked for;
    // never activate on it.
    if (payment.amount !== transaction.amount * 100) {
      console.error('[PaymentWebhook] amount mismatch', {
        order: payment.orderId,
        expectedPaise: transaction.amount * 100,
        receivedPaise: payment.amount,
      });
      return 'amount_mismatch';
    }

    if (transaction.status !== 'SUCCESS') {
      try {
        await CommitmentTransaction.updateOne(
          { _id: transaction._id, status: { $ne: 'SUCCESS' } },
          { $set: { status: 'SUCCESS', razorpayPaymentId: payment.id } }
        );
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        // one_successful_deposit: a different payment already paid for this commitment, so this
        // one is a second charge. Keep it out of the deposit ledger and queue its full refund.
        await CommitmentTransaction.updateOne(
          { _id: transaction._id },
          {
            $set: {
              status: 'FAILED',
              razorpayPaymentId: payment.id,
              reference: 'Duplicate payment - refund queued',
            },
          }
        );
        await queueFullRefund(transaction, payment.id, 'DUPLICATE_PAYMENT');
        console.error('[PaymentWebhook] duplicate payment, refund queued', {
          commitment: transaction.commitmentId.toString(),
          payment: payment.id,
        });
        return 'duplicate_refund_queued';
      }
    }

    const commitment = await Commitment.findById(transaction.commitmentId);
    if (!commitment) return 'commitment_not_pending';
    if (commitment.status === 'ACTIVE') return 'already_active';
    if (commitment.status !== 'PENDING_PAYMENT') {
      // Never started (cancelled while the payment was in flight): the money has no commitment to
      // belong to, so it goes back. A commitment that did start is just a replay of its own deposit.
      if (commitment.startDate === null) {
        await queueFullRefund(transaction, payment.id, 'UNACTIVATABLE');
        return 'cancelled_refund_queued';
      }
      return 'commitment_not_pending';
    }

    try {
      await CommitmentService.activateAfterPayment(commitment, now);
    } catch (error) {
      // Lost a race with another activation: fine as long as it ended up ACTIVE.
      const current = await Commitment.findById(commitment._id);
      if (current?.status === 'ACTIVE') return 'already_active';
      if (error instanceof ApiError && PERMANENT_ACTIVATION_ERRORS.has(error.code)) {
        await Commitment.updateOne(
          { _id: commitment._id, status: 'PENDING_PAYMENT' },
          { $set: { status: 'CANCELLED' } }
        );
        await queueFullRefund(transaction, payment.id, 'UNACTIVATABLE');
        console.error('[PaymentWebhook] commitment cannot start, cancelled and refund queued', {
          commitment: commitment._id.toString(),
          code: error.code,
        });
        return 'cancelled_refund_queued';
      }
      throw error;
    }
    log({ source, order: payment.orderId, commitment: commitment._id.toString() });
    return 'activated';
  }
}
