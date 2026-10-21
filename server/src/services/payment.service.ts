import { env } from '../config/env.js';
import { isRazorpayConfigured, razorpayClient } from '../integrations/razorpay/razorpay.client.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { CommitmentDto, getOwnedCommitment } from './commitment.shared.js';
import { CommitmentService } from './commitment.service.js';
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

    const existing = await CommitmentTransaction.findOne({
      commitmentId: commitment._id,
      type: 'DEPOSIT',
      status: 'PENDING',
    }).sort({ createdAt: -1 });

    if (existing?.razorpayOrderId) {
      return {
        keyId: env.RAZORPAY_KEY_ID!,
        orderId: existing.razorpayOrderId,
        amount: commitment.depositAmount * 100,
        currency: 'INR',
      };
    }

    const order = await razorpayClient.createOrder(
      commitment.depositAmount * 100,
      commitment._id.toString()
    );

    await CommitmentTransaction.create({
      userId: commitment.userId,
      commitmentId: commitment._id,
      type: 'DEPOSIT',
      amount: commitment.depositAmount,
      status: 'PENDING',
      reference: 'Commitment deposit',
      razorpayOrderId: order.id,
    });

    return {
      keyId: env.RAZORPAY_KEY_ID!,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    };
  }

  /**
   * Verifies the Checkout signature server-side and only then activates the commitment. Never
   * trust the frontend's "payment succeeded" callback on its own — the signature is the proof.
   * Idempotent: a transaction already marked SUCCESS (duplicate verify call) just re-activates
   * (a no-op if already ACTIVE) instead of erroring.
   */
  static async verifyPayment(
    userId: string,
    commitmentId: string,
    input: VerifyPaymentInput,
    now: Date = new Date()
  ): Promise<CommitmentDto> {
    if (!isRazorpayConfigured()) throw notConfigured();

    const commitment = await getOwnedCommitment(userId, commitmentId);

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

    if (transaction.status !== 'SUCCESS') {
      const valid = razorpayClient.verifyCheckoutSignature(
        input.razorpayOrderId,
        input.razorpayPaymentId,
        input.razorpaySignature
      );
      if (!valid) {
        transaction.status = 'FAILED';
        await transaction.save();
        throw ApiError.badRequest('PAYMENT_SIGNATURE_INVALID', 'Payment could not be verified.');
      }

      transaction.status = 'SUCCESS';
      transaction.razorpayPaymentId = input.razorpayPaymentId;
      await transaction.save();
    }

    return CommitmentService.activateAfterPayment(commitment, now);
  }
}
