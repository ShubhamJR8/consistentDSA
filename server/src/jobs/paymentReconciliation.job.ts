import { env } from '../config/env.js';
import { isRazorpayConfigured, razorpayClient } from '../integrations/razorpay/razorpay.client.js';
import { Commitment } from '../models/commitment.model.js';
import {
  CommitmentTransaction,
  ICommitmentTransaction,
} from '../models/commitmentTransaction.model.js';
import { describeError, logger } from '../utils/logger.js';
import { PaymentWebhookService } from '../services/paymentWebhook.service.js';

/**
 * Last line of defence for "paid, but never activated": if the browser's /payments/verify call and
 * Razorpay's webhook both failed to reach us, this finds the deposit still PENDING, asks Razorpay
 * whether the order was captured, and runs the same idempotent activation the webhook does. It never
 * refunds or moves money, and a failed Razorpay call just leaves the deposit for the next sweep.
 */
const LOOKBACK_DAYS = 7;
const MAX_PER_SWEEP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReconciliationClient {
  fetchOrderPayments: typeof razorpayClient.fetchOrderPayments;
}

export const runPaymentReconciliationSweep = async (
  now: Date = new Date(),
  client: ReconciliationClient = razorpayClient
): Promise<number> => {
  const cutoff = new Date(now.getTime() - env.PAYMENT_RECONCILIATION_MIN_AGE_MINUTES * 60_000);
  let activated = 0;

  const apply = async (
    transaction: ICommitmentTransaction,
    payment: { id: string; amount: number }
  ): Promise<void> => {
    const outcome = await PaymentWebhookService.applyCapture(
      { id: payment.id, orderId: transaction.razorpayOrderId!, amount: payment.amount },
      'reconciliation',
      now
    );
    if (outcome === 'activated') activated += 1;
  };

  // 1. Orders handed out but never confirmed: ask Razorpay whether they were captured. Cancelled
  //    commitments are included — the user may have paid after cancelling, and that money must be
  //    refunded rather than left unrecorded.
  const pending = await CommitmentTransaction.find({
    type: 'DEPOSIT',
    status: 'PENDING',
    razorpayOrderId: { $exists: true },
    createdAt: { $lt: cutoff, $gt: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS) },
  })
    .sort({ createdAt: 1 })
    .limit(MAX_PER_SWEEP);

  for (const transaction of pending) {
    try {
      const commitment = await Commitment.findById(transaction.commitmentId).select('status');
      if (commitment?.status !== 'PENDING_PAYMENT' && commitment?.status !== 'CANCELLED') continue;

      const payments = await client.fetchOrderPayments(transaction.razorpayOrderId!);
      const capture = payments.find((payment) => payment.status === 'captured');
      if (capture) await apply(transaction, capture);
    } catch (error) {
      logger.error('payment_reconciliation_step_failed', {
        transaction: transaction._id.toString(),
        ...describeError(error),
      });
    }
  }

  // 2. Payment recorded but the commitment never started (activation failed after the money was
  //    recorded). No Razorpay call needed: just retry the activation, which either completes it or
  //    cancels the commitment and queues the refund if it can never start.
  const waiting = await Commitment.find({ status: 'PENDING_PAYMENT' })
    .select('_id')
    .limit(MAX_PER_SWEEP);
  const paid = waiting.length
    ? await CommitmentTransaction.find({
        commitmentId: { $in: waiting.map((commitment) => commitment._id) },
        type: 'DEPOSIT',
        status: 'SUCCESS',
        razorpayPaymentId: { $exists: true },
        razorpayOrderId: { $exists: true },
        createdAt: { $lt: cutoff },
      })
    : [];
  for (const transaction of paid) {
    try {
      await apply(transaction, {
        id: transaction.razorpayPaymentId!,
        amount: transaction.amount * 100,
      });
    } catch (error) {
      // A payment is recorded but its commitment still cannot start: a person should look.
      logger.alert('paid_commitment_not_activated', {
        transaction: transaction._id.toString(),
        ...describeError(error),
      });
    }
  }
  return activated;
};

let timer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

export const startPaymentReconciliationJob = (intervalMinutes: number): void => {
  if (timer || !isRazorpayConfigured()) return;
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;
  timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void runPaymentReconciliationSweep()
      .catch((error) => logger.error('payment_reconciliation_failed', describeError(error)))
      .finally(() => {
        sweeping = false;
      });
  }, intervalMs);
  timer.unref();
};

export const stopPaymentReconciliationJob = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
