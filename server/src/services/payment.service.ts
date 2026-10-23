import { env } from '../config/env.js';
import { isRazorpayConfigured, razorpayClient } from '../integrations/razorpay/razorpay.client.js';
import {
  CommitmentTransaction,
  ICommitmentTransaction,
} from '../models/commitmentTransaction.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { describeError, logger } from '../utils/logger.js';
import { isDuplicateKeyError } from '../utils/mongo.js';
import { CommitmentDto, getOwnedCommitment, toCommitmentDto } from './commitment.shared.js';
import { PaymentWebhookService } from './paymentWebhook.service.js';
import { assertCanStartCommitment } from './leetcodeRequirement.service.js';
import { Plan } from '../models/plan.model.js';

export interface CreateOrderDto {
  keyId: string;
  orderId: string;
  /** Paise (smallest currency unit) — what Razorpay Checkout expects. */
  amount: number;
  currency: string;
}

export interface VerifyPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

const notConfigured = () =>
  ApiError.internal('PAYMENTS_NOT_CONFIGURED', 'Payments are not available right now.');

const gatewayUnavailable = () =>
  ApiError.serviceUnavailable(
    'PAYMENT_GATEWAY_UNAVAILABLE',
    'Payments are temporarily unavailable. Please try again in a moment.'
  );

// A reservation that never got an order id (the creating request died) is reclaimable after this.
const STALE_RESERVATION_MS = 30_000;

export class PaymentService {
  /**
   * Creates (or reuses) a Razorpay order for a commitment's deposit. Idempotent across
   * retries/page-refreshes: a still-PENDING DEPOSIT row from an earlier call is reused rather
   * than minting a fresh order every time.
   */
  static async createOrder(userId: string, commitmentId: string): Promise<CreateOrderDto> {
    if (!isRazorpayConfigured()) throw notConfigured();

    // Real money moves here — an unverified email means refund/dispute correspondence could
    // never reach the account holder, so deposits are blocked until it's confirmed.
    const user = await User.findById(userId).select(
      'emailVerified leetcodeUsername leetcodeVerifiedAt'
    );
    if (!user || !user.emailVerified) {
      throw ApiError.forbidden(
        'EMAIL_NOT_VERIFIED',
        'Please verify your email before making a deposit.'
      );
    }

    const commitment = await getOwnedCommitment(userId, commitmentId);
    if (commitment.status !== 'PENDING_PAYMENT') {
      throw ApiError.conflict(
        'COMMITMENT_NOT_PENDING_PAYMENT',
        'This commitment is not awaiting payment.'
      );
    }

    // Re-checked here, not just at creation: the account may have been changed since.
    const plan = await Plan.findById(commitment.planId);
    if (plan) await assertCanStartCommitment(user, plan.problemIds);

    // A payment already recorded means activation is merely pending (webhook/sweep will finish it);
    // a second order would let the user pay twice.
    if (
      await CommitmentTransaction.exists({
        commitmentId: commitment._id,
        type: 'DEPOSIT',
        status: 'SUCCESS',
      })
    ) {
      throw ApiError.conflict(
        'PAYMENT_ALREADY_RECEIVED',
        'Your payment was received and your commitment is being activated.'
      );
    }

    const toDto = (orderId: string): CreateOrderDto => ({
      keyId: env.RAZORPAY_KEY_ID!,
      orderId,
      amount: commitment.depositAmount * 100,
      currency: 'INR',
    });

    // Reserve the single pending-deposit slot *before* calling Razorpay (one_pending_deposit unique
    // index), so concurrent clicks/tabs/retries can't each mint a payable order.
    let reservation: ICommitmentTransaction | null = null;
    for (let attempt = 0; attempt < 2 && !reservation; attempt += 1) {
      try {
        reservation = await CommitmentTransaction.create({
          userId: commitment.userId,
          commitmentId: commitment._id,
          type: 'DEPOSIT',
          amount: commitment.depositAmount,
          status: 'PENDING',
          reference: 'Commitment deposit',
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const existing = await CommitmentTransaction.findOne({
          commitmentId: commitment._id,
          type: 'DEPOSIT',
          status: 'PENDING',
        });
        if (existing?.razorpayOrderId) return toDto(existing.razorpayOrderId);
        // Another request is mid-way through creating the order. If it died before saving one,
        // clear its stale reservation and take over; otherwise ask the caller to retry.
        if (existing && Date.now() - existing.createdAt.getTime() > STALE_RESERVATION_MS) {
          await CommitmentTransaction.deleteOne({
            _id: existing._id,
            razorpayOrderId: { $exists: false },
          });
        } else if (existing) {
          break;
        }
      }
    }
    if (!reservation) {
      throw ApiError.conflict(
        'ORDER_IN_PROGRESS',
        'Your payment is being prepared. Please try again in a moment.'
      );
    }

    let order;
    try {
      order = await razorpayClient.createOrder(
        commitment.depositAmount * 100,
        commitment._id.toString()
      );
    } catch (error) {
      // Unknown whether Razorpay created an order; nothing was handed to the user, so it can't be
      // paid. Release the slot so a retry starts clean.
      logger.error('razorpay_create_order_failed', describeError(error));
      await CommitmentTransaction.deleteOne({ _id: reservation._id });
      throw gatewayUnavailable();
    }

    await CommitmentTransaction.updateOne(
      { _id: reservation._id },
      { $set: { razorpayOrderId: order.id } }
    );
    return {
      keyId: env.RAZORPAY_KEY_ID!,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    };
  }

  /**
   * Browser-side confirmation. The signature proves the callback came from Razorpay's Checkout, then
   * the payment is fetched from Razorpay to confirm it is captured, belongs to this order and is for
   * the amount we asked for. Activation goes through the same idempotent path as the webhook and the
   * reconciliation sweep, so whichever of the three arrives first wins and the rest are no-ops.
   * A bad signature never changes any stored state: marking the deposit FAILED here would let a bogus
   * call hide a real payment from the sweep.
   */
  static async verifyPayment(
    userId: string,
    commitmentId: string,
    input: VerifyPaymentInput,
    now: Date = new Date()
  ): Promise<CommitmentDto> {
    if (!isRazorpayConfigured()) throw notConfigured();

    const commitment = await getOwnedCommitment(userId, commitmentId);

    // Scopes the order to this commitment (and so this user): someone else's order is a 404.
    const transaction = await CommitmentTransaction.findOne({
      commitmentId: commitment._id,
      type: 'DEPOSIT',
      razorpayOrderId: input.razorpayOrderId,
    });
    if (!transaction) {
      throw ApiError.notFound(
        'PAYMENT_NOT_FOUND',
        'No matching payment order was found for this commitment.'
      );
    }

    if (
      !razorpayClient.verifyCheckoutSignature(
        input.razorpayOrderId,
        input.razorpayPaymentId,
        input.razorpaySignature
      )
    ) {
      throw ApiError.badRequest('PAYMENT_SIGNATURE_INVALID', 'Payment could not be verified.');
    }

    let payment;
    try {
      payment = await razorpayClient.fetchPayment(input.razorpayPaymentId);
    } catch (error) {
      logger.error('razorpay_fetch_payment_failed', {
        payment: input.razorpayPaymentId,
        ...describeError(error),
      });
      throw ApiError.serviceUnavailable(
        'PAYMENT_GATEWAY_UNAVAILABLE',
        "We couldn't confirm your payment with Razorpay yet. If you were charged, your commitment will activate automatically within a few minutes."
      );
    }
    if (payment.orderId !== input.razorpayOrderId) {
      throw ApiError.badRequest('PAYMENT_ORDER_MISMATCH', 'Payment does not match this order.');
    }
    if (payment.status !== 'captured') {
      throw ApiError.conflict(
        'PAYMENT_NOT_CAPTURED',
        'Your payment is still being confirmed. Your commitment will activate automatically once it is.'
      );
    }

    const outcome = await PaymentWebhookService.applyCapture(
      { id: payment.id, orderId: input.razorpayOrderId, amount: payment.amount },
      'checkout',
      now
    );

    if (outcome === 'amount_mismatch') {
      throw ApiError.badRequest(
        'PAYMENT_AMOUNT_MISMATCH',
        'Payment amount does not match the deposit.'
      );
    }
    if (outcome === 'duplicate_refund_queued') {
      throw ApiError.conflict(
        'DUPLICATE_PAYMENT',
        'This commitment was already paid for. The extra payment will be refunded.'
      );
    }
    if (outcome === 'cancelled_refund_queued') {
      throw ApiError.conflict(
        'COMMITMENT_CANCELLED',
        'This commitment could not start. Your payment will be refunded.'
      );
    }

    return toCommitmentDto(await getOwnedCommitment(userId, commitmentId));
  }
}
