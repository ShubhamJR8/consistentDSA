import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';

// Keyed by IP + email so one leaked/shared IP (office NAT, campus wifi) can't lock out every
// account behind it — a credential-stuffing run against many emails from one IP still gets
// throttled, but distinct users on that IP logging in normally don't collide. ipKeyGenerator
// normalizes IPv6 addresses to a /56 subnet so a single client can't dodge the limit by cycling
// through addresses within their own subnet.
const keyByIpAndEmail = (req: { ip?: string; body?: { email?: string } }): string =>
  `${ipKeyGenerator(req.ip ?? '')}:${req.body?.email ?? ''}`;

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIpAndEmail,
  // Skipped in tests so the existing integration suite (which fires many requests from one IP)
  // doesn't need per-test throttling workarounds.
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(
      ApiError.tooManyRequests('AUTH_RATE_LIMITED', 'Too many attempts, please try again later')
    );
  },
});

// Per authenticated user (these routes sit behind requireAuth), so one account can't spam LeetCode
// lookups or grind challenges. Not skipped in tests, so the limit itself is testable. In-memory:
// with several server instances each keeps its own count (the limit is per instance).
const perUser = (req: { user?: { userId: string } }): string => req.user?.userId ?? 'anonymous';

const perUserLimiter = (limit: number, code: string) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perUser,
    handler: (_req, _res, next) => {
      next(ApiError.tooManyRequests(code, 'Too many attempts, please try again later'));
    },
  });

export const leetCodeChallengeRateLimiter = perUserLimiter(
  env.LEETCODE_CHALLENGE_RATE_LIMIT,
  'LEETCODE_RATE_LIMITED'
);
export const leetCodeVerifyRateLimiter = perUserLimiter(
  env.LEETCODE_VERIFY_RATE_LIMIT,
  'LEETCODE_RATE_LIMITED'
);

// Order creation calls Razorpay and verification is the money path: cap both per user.
export const paymentRateLimiter = perUserLimiter(30, 'PAYMENT_RATE_LIMITED');
