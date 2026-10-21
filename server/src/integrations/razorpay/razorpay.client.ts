import { createHmac } from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../../config/env.js';

// All Razorpay-specific wiring lives in this file. Nothing outside it should construct the SDK
// client directly or compute signatures by hand.

export const isRazorpayConfigured = (): boolean =>
  Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

// Constructed lazily (not at module load) so the server can boot without Razorpay keys set —
// only routes that actually touch payments need them.
let client: Razorpay | null = null;
const getClient = (): Razorpay => {
  if (!isRazorpayConfigured()) {
    throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET unset)');
  }
  if (!client) {
    client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }
  return client;
};

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RazorpayRefund {
  id: string;
  amount: number;
  status: string;
}

export const razorpayClient = {
  /** Amount is in paise (smallest currency unit) — the caller converts rupees before calling. */
  async createOrder(amountPaise: number, receipt: string): Promise<RazorpayOrder> {
    const order = await getClient().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt,
    });
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      status: order.status,
    };
  },

  /**
   * Verifies the HMAC-SHA256 signature Razorpay's Checkout returns after a successful payment.
   * This is the only thing that proves a payment actually happened — never trust a frontend
   * "payment succeeded" callback without this check.
   */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!env.RAZORPAY_KEY_SECRET) return false;
    const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return expected === signature;
  },

  /**
   * Issues a partial (or full) refund against an already-captured payment. Never called
   * automatically — only from the manually-run refund script, after a human has checked the
   * commitment's numbers. `amountPaise` is what comes back to the payer; whatever was captured
   * beyond it simply stays in the account, which is how forfeiture is realized (no separate
   * payout call needed for the forfeited portion).
   */
  async refund(paymentId: string, amountPaise: number): Promise<RazorpayRefund> {
    const refund = await getClient().payments.refund(paymentId, { amount: amountPaise });
    return {
      id: refund.id,
      amount: Number(refund.amount),
      status: refund.status,
    };
  },
};
