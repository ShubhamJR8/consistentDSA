import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Razorpay signs the *raw* webhook body (HMAC-SHA256, hex) with the webhook secret and sends it in
 * the X-Razorpay-Signature header. It must be computed over the exact bytes received — parsing and
 * re-serializing the JSON changes them — and compared in constant time.
 */
export const verifyWebhookSignature = (
  rawBody: Buffer,
  signature: string | undefined,
  secret: string
): boolean => {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
};
