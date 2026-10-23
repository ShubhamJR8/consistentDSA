import { createHmac, timingSafeEqual } from 'crypto';
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

// A hung gateway call must not hold a user's request (or a sweep) open indefinitely. The underlying
// request may still complete on Razorpay's side, which is why callers treat a timeout as "unknown",
// never as "didn't happen".
const GATEWAY_TIMEOUT_MS = 10_000;
const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Razorpay ${label} timed out after ${GATEWAY_TIMEOUT_MS}ms`)),
      GATEWAY_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RazorpayOrderPayment {
  id: string;
  /** Paise. */
  amount: number;
  /** created | authorized | captured | refunded | failed */
  status: string;
}

export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  /** Paise. */
  amount: number;
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
    const order = await withTimeout(
      getClient().orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt,
        // Capture automatically: an "authorized but never captured" payment would otherwise pass the
        // checkout signature check while no money is actually taken (and no webhook ever fires).
        payment_capture: true,
      }),
      'createOrder'
    );
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      status: order.status,
    };
  },

  /** Every payment attempt made against an order — used to find captures whose webhook and browser
   *  callback both never reached us. */
  async fetchOrderPayments(orderId: string): Promise<RazorpayOrderPayment[]> {
    const result = await withTimeout(getClient().orders.fetchPayments(orderId), 'fetchPayments');
    return result.items.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      status: payment.status,
    }));
  },

  /** Server-side source of truth for one payment: the checkout signature only proves the browser
   *  saw a success, not that the payment is captured or for the amount we asked for. */
  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    const payment = await withTimeout(getClient().payments.fetch(paymentId), 'fetchPayment');
    return {
      id: payment.id,
      orderId: payment.order_id ?? null,
      amount: Number(payment.amount),
      status: payment.status,
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
      .digest();
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
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
