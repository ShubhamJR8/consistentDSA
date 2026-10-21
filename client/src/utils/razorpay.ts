// Thin wrapper around Razorpay's Checkout.js. Nothing outside this file should know how the
// script is loaded or what its global looks like.

interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  handler: (response: RazorpayCheckoutSuccess) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

export interface RazorpayCheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutInstance {
  open(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loadPromise: Promise<void> | null = null;

const loadCheckoutScript = (): Promise<void> => {
  if (window.Razorpay) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.onload = () => resolve();
      script.onerror = () => {
        loadPromise = null;
        reject(new Error('Could not reach Razorpay. Check your connection and try again.'));
      };
      document.body.appendChild(script);
    });
  }
  return loadPromise;
};

export interface OpenCheckoutInput {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  onSuccess: (result: RazorpayCheckoutSuccess) => void;
  onDismiss?: () => void;
}

export async function openRazorpayCheckout(input: OpenCheckoutInput): Promise<void> {
  await loadCheckoutScript();
  if (!window.Razorpay) {
    throw new Error('Could not reach Razorpay. Check your connection and try again.');
  }
  const checkout = new window.Razorpay({
    key: input.keyId,
    order_id: input.orderId,
    amount: input.amount,
    currency: input.currency,
    name: 'CommitDSA',
    description: 'Commitment deposit',
    handler: input.onSuccess,
    modal: { ondismiss: input.onDismiss },
    theme: { color: '#6366f1' },
  });
  checkout.open();
}
