import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Dev-only fallback so `npm run dev` works with zero setup. Never used in production — see the
// superRefine below, which fails startup if a real JWT_SECRET isn't provided there.
const DEV_JWT_SECRET = 'commit_dsa_super_secret_jwt_key_dev_2026_at_least_32_chars';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(5001),
    MONGODB_URI: z.string().default('mongodb://localhost:27017/commit_dsa'),
    JWT_SECRET: z.string().min(32).optional(),
    JWT_EXPIRES_IN: z.string().default('7d'),
    CLIENT_URL: z.string().default('http://localhost:5173'),
    // Code judge (Judge0). Left unset in dev until a key is provided — the judge routes fail
    // clearly rather than the server refusing to boot, since most of the app works without them.
    JUDGE0_API_URL: z.string().url().optional(),
    JUDGE0_API_KEY: z.string().optional(),
    JUDGE0_API_HOST: z.string().default('judge0-ce.p.rapidapi.com'),
    // LeetCode verification runs against Alfa (https://github.com/alfaarghya/alfa-leetcode-api), an
    // UNOFFICIAL third-party wrapper around LeetCode's public data. Its availability and whether
    // LeetCode permits this use are not guaranteed — keep it behind the integration client so it can
    // be switched off or replaced. No user credentials are ever involved. The background sweep is
    // off by default; the manual "Check submission" route works regardless.
    LEETCODE_VERIFICATION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LEETCODE_VERIFICATION_INTERVAL_MINUTES: z.coerce.number().default(5),
    LEETCODE_API_BASE_URL: z.string().url().default('https://alfa-leetcode-api.onrender.com'),
    // Render's free tier cold-starts slowly, so this is generous; a timeout is just a retryable error.
    LEETCODE_API_TIMEOUT_MS: z.coerce.number().default(15000),
    LEETCODE_API_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
    // Alfa caps this at 20 regardless of what's requested (verified against the hosted API).
    LEETCODE_SUBMISSIONS_LIMIT: z.coerce.number().int().min(1).max(20).default(20),
    LEETCODE_CACHE_TTL_SECONDS: z.coerce.number().default(30),
    // After a day's deadline, a day that still has unchecked LeetCode problems (for a user with a
    // verified account) is not marked MISSED until this long has passed, so the verifier gets a
    // chance to find a solve from just before the deadline. Solves must still fall inside the day.
    // If the last check was inconclusive (provider down / history truncated) the wait extends to the
    // hard cap below. Neither delays or changes anything for days with nothing left to verify.
    LEETCODE_GRACE_MINUTES: z.coerce.number().min(0).default(30),
    // Cap for an *inconclusive but not outage* check: the provider's 20-submission window may have
    // hidden a solve. That can never resolve by waiting (the window only moves forward), so it is short.
    LEETCODE_GRACE_OUTAGE_MAX_HOURS: z.coerce.number().min(0).default(6),
    // A day is held open — never marked MISSED — while the provider was unreachable at the last
    // check, or nothing has checked it since its deadline (e.g. the sweep itself was down). It is
    // re-verified as soon as the provider is back; this is only the absolute backstop.
    LEETCODE_GRACE_PROVIDER_DOWN_MAX_HOURS: z.coerce.number().min(0).default(72),
    // Requests per rolling hour this server will send to the provider; 0 = unlimited. The hosted Alfa
    // allows 120/hour per IP (shared with every other user of this server), so the default stays under
    // it. Raise it only when pointing LEETCODE_API_BASE_URL at your own patched instance.
    LEETCODE_API_HOURLY_BUDGET: z.coerce.number().int().min(0).default(100),
    // When this little of the hourly budget is left, the background sweep only spends it on days that
    // are already past their deadline, keeping the rest for users clicking "Check submission".
    LEETCODE_SWEEP_RESERVE_PERCENT: z.coerce.number().min(0).max(100).default(30),
    LEETCODE_CHALLENGE_TTL_MINUTES: z.coerce.number().default(10),
    LEETCODE_CHALLENGE_RATE_LIMIT: z.coerce.number().default(5),
    LEETCODE_VERIFY_RATE_LIMIT: z.coerce.number().default(10),
    // Finalizes ACTIVE commitments past their last day and queues (never executes) their refund —
    // safe to run always since it never calls Razorpay. See jobs/commitmentSettlement.job.ts.
    COMMITMENT_SETTLEMENT_INTERVAL_MINUTES: z.coerce.number().default(15),
    // Razorpay test mode. Left unset in dev until a key pair is provided — payment routes fail
    // clearly rather than the server refusing to boot, since most of the app works without them.
    // KEY_ID is safe to hand to the frontend's Checkout widget; KEY_SECRET never leaves the server.
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    // Signs payment webhooks (Dashboard > Settings > Webhooks) — a different secret from the API key.
    // Without it POST /api/payments/webhook answers 503 and a payment whose browser callback never
    // arrives is not activated automatically.
    RAZORPAY_WEBHOOK_SECRET: z.string().min(8).optional(),
    // Safety net for payments whose browser callback and webhook both went missing: asks Razorpay
    // about deposits still PENDING after this long and activates the ones that were captured. It
    // only ever activates; it never refunds or moves money. Runs only when Razorpay is configured.
    // A commitment activated with fewer than this many hours left in the user's local day starts
    // tomorrow instead, so a late-evening payment (or a delayed webhook) can't hand them a Day 1 with
    // minutes on the clock — and a forfeiture they had no fair chance to avoid.
    PAYMENT_MIN_START_HOURS: z.coerce.number().min(0).default(3),
    PAYMENT_RECONCILIATION_INTERVAL_MINUTES: z.coerce.number().default(10),
    PAYMENT_RECONCILIATION_MIN_AGE_MINUTES: z.coerce.number().min(0).default(10),
    // Generic SMTP, so any provider works (Gmail, SES, SendGrid, Resend, etc). Left unset in dev —
    // password-reset links are logged to the console instead of emailed. See email.service.ts.
    EMAIL_HOST: z.string().optional(),
    EMAIL_PORT: z.coerce.number().default(587),
    EMAIL_USER: z.string().optional(),
    EMAIL_PASS: z.string().optional(),
    EMAIL_FROM: z.string().default('CommitDSA <no-reply@commitdsa.app>'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && !data.JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be set to a real 32+ char secret in production.',
      });
    }
    if (data.NODE_ENV === 'production') {
      // Everything that silently degrades in development must be real in production: payments with
      // no webhook lose users' money, and an unconfigured mailer logs account-takeover links.
      const required = [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
        'EMAIL_HOST',
        'EMAIL_USER',
        'EMAIL_PASS',
      ] as const;
      for (const key of required) {
        if (!data[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must be set in production.`,
          });
        }
      }
      // Without the sweep nothing verifies a day automatically, so solved days could be missed.
      if (!data.LEETCODE_VERIFICATION_ENABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LEETCODE_VERIFICATION_ENABLED'],
          message: 'LEETCODE_VERIFICATION_ENABLED must be true in production.',
        });
      }
      // The auth cookie is SameSite=None; Secure, and the origin allow-list is built from this.
      if (!data.CLIENT_URL.startsWith('https://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLIENT_URL'],
          message: 'CLIENT_URL must be an https:// URL in production.',
        });
      }
    }
  })
  .transform((data) => ({
    ...data,
    JWT_SECRET: data.JWT_SECRET ?? DEV_JWT_SECRET,
  }));

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
};

export const env = parseEnv();
