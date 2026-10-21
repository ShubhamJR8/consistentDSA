import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Dev-only fallback so `npm run dev` works with zero setup. Never used in production — see the
// superRefine below, which fails startup if a real JWT_SECRET isn't provided there.
const DEV_JWT_SECRET = 'commit_dsa_super_secret_jwt_key_dev_2026_at_least_32_chars';

const envSchema = z
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
    // LeetCode-based verification: no credentials, just a public-username lookup against LeetCode's
    // own recent-Accepted-submissions data. Disabled by default — the manual "Check Submission"
    // route works regardless; this only controls the periodic background sweep.
    LEETCODE_VERIFICATION_ENABLED: z.coerce.boolean().default(false),
    LEETCODE_VERIFICATION_INTERVAL_MINUTES: z.coerce.number().default(5),
    LEETCODE_CACHE_TTL_SECONDS: z.coerce.number().default(60),
    // Finalizes ACTIVE commitments past their last day and queues (never executes) their refund —
    // safe to run always since it never calls Razorpay. See jobs/commitmentSettlement.job.ts.
    COMMITMENT_SETTLEMENT_INTERVAL_MINUTES: z.coerce.number().default(15),
    // Razorpay test mode. Left unset in dev until a key pair is provided — payment routes fail
    // clearly rather than the server refusing to boot, since most of the app works without them.
    // KEY_ID is safe to hand to the frontend's Checkout widget; KEY_SECRET never leaves the server.
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
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
