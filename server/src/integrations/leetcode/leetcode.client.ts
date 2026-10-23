import { z } from 'zod';
import { env } from '../../config/env.js';

// All provider-specific HTTP and wire-format handling lives in this file; nothing outside it should
// know what Alfa's responses look like.
//
// NOTE: Alfa (https://github.com/alfaarghya/alfa-leetcode-api) is an UNOFFICIAL third-party wrapper
// around LeetCode's public data. Its availability — and whether LeetCode permits this use — is not
// guaranteed. Keep it isolated so it can be disabled or swapped for an official integration.
//
// Observed behaviour of the hosted API (inspected, not documented guarantees):
//  - GET /{user} → flat JSON with `username` and `about` (plain string, "" when empty). A missing
//    user still returns HTTP 200, with `{ errors: [...], data: { matchedUser: null } }`.
//  - GET /{user}/acSubmission?limit=N → `{ count, submission: [{ title, titleSlug, timestamp,
//    statusDisplay, lang }] }`, newest first. `timestamp` is epoch SECONDS as a string. There is no
//    submission id. The list is capped at 20 even when a larger limit is requested, and a missing
//    user is indistinguishable from a user with no submissions.

export interface LeetCodeProfile {
  username: string;
  about: string;
}

export interface LeetCodeAcceptedSubmission {
  title: string;
  titleSlug: string;
  /** Milliseconds since epoch (converted from the provider's seconds). */
  timestamp: number;
  language?: string;
}

export interface AcceptedSubmissionsResult {
  /** Newest first, Accepted only. */
  submissions: LeetCodeAcceptedSubmission[];
  /** The number of entries we asked the provider for. Hitting it means older ones may be cut off. */
  limit: number;
}

/** The provider failed or answered with something we can't trust. Always retryable — never evidence
 *  that the user did or didn't do anything. `message` is for server logs only. */
export class LeetCodeProviderError extends Error {
  /** Set when the provider told us to back off (HTTP 429): seconds until it's worth trying again. */
  readonly retryAfterSeconds?: number;

  constructor(message: string, options?: { cause?: unknown; retryAfterSeconds?: number }) {
    super(message, options);
    this.name = 'LeetCodeProviderError';
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export interface LeetCodeClient {
  /** Resolves `null` when the username doesn't exist on LeetCode. Throws LeetCodeProviderError when
   *  the provider is unreachable or returns an unexpected shape. */
  getProfile(username: string): Promise<LeetCodeProfile | null>;
  getAcceptedSubmissions(username: string, limit?: number): Promise<AcceptedSubmissionsResult>;
}

// Matches the validation applied at the API boundary; re-checked here so no caller can build a URL
// from an unvalidated string.
export const LEETCODE_USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

const MAX_ABOUT_LENGTH = 20_000;

const profileSchema = z.object({
  username: z.string().min(1),
  // null/"" both mean "empty"; a missing or non-string field means the shape changed.
  about: z.string().nullable(),
});

const notFoundSchema = z.object({
  errors: z.array(z.unknown()).min(1),
  data: z.object({ matchedUser: z.null() }).passthrough(),
});

const submissionsSchema = z.object({
  submission: z.array(
    z.object({
      title: z.string(),
      titleSlug: z.string().min(1),
      timestamp: z.union([z.string(), z.number()]),
      statusDisplay: z.string(),
      lang: z.string().optional(),
    })
  ),
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

/** GETs `path` on the configured base URL with a timeout and bounded exponential backoff. Only
 *  network errors, timeouts and 408/425/429/5xx are retried; the rest fail immediately. */
// Alfa's hosted instance allows 120 requests/hour per IP and answers 429 with Retry-After beyond
// that. Once told to back off we stop calling entirely until then, rather than burning attempts
// (or the sweep's requests) against a limit that is already hit.
let blockedUntil = 0;
const DEFAULT_BACKOFF_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 3600;

const backoffError = (): LeetCodeProviderError =>
  new LeetCodeProviderError('Alfa rate limit reached', {
    retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000)),
  });

const getJson = async (path: string): Promise<unknown> => {
  if (Date.now() < blockedUntil) throw backoffError();
  const url = new URL(path, env.LEETCODE_API_BASE_URL);
  let lastError: LeetCodeProviderError = new LeetCodeProviderError('Alfa request failed');

  for (let attempt = 1; attempt <= env.LEETCODE_API_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.LEETCODE_API_TIMEOUT_MS);
    let retryable = true;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.ok) return (await res.json()) as unknown;
      if (res.status === 429) {
        const header = Number(res.headers.get('retry-after'));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_BACKOFF_SECONDS;
        blockedUntil = Date.now() + Math.min(seconds, MAX_BACKOFF_SECONDS) * 1000;
        throw backoffError();
      }
      lastError = new LeetCodeProviderError(`Alfa responded with HTTP ${res.status}`);
      retryable = RETRYABLE_STATUSES.has(res.status);
    } catch (error) {
      if (error instanceof LeetCodeProviderError) {
        // Our own backoff signal: keep it intact and don't retry into a limit we just hit.
        throw error;
      }
      lastError = new LeetCodeProviderError('Alfa request failed', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
    if (!retryable || attempt === env.LEETCODE_API_MAX_ATTEMPTS) break;
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastError;
};

const assertUsername = (username: string): string => {
  if (!LEETCODE_USERNAME_PATTERN.test(username)) {
    throw new LeetCodeProviderError('Invalid LeetCode username');
  }
  return encodeURIComponent(username);
};

export const parseProfile = (payload: unknown): LeetCodeProfile | null => {
  if (notFoundSchema.safeParse(payload).success) return null;
  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) throw new LeetCodeProviderError('Unexpected Alfa profile schema');
  return {
    username: parsed.data.username,
    about: (parsed.data.about ?? '').slice(0, MAX_ABOUT_LENGTH),
  };
};

export const parseAcceptedSubmissions = (
  payload: unknown,
  limit: number
): AcceptedSubmissionsResult => {
  const parsed = submissionsSchema.safeParse(payload);
  if (!parsed.success) throw new LeetCodeProviderError('Unexpected Alfa submissions schema');

  const submissions: LeetCodeAcceptedSubmission[] = [];
  for (const item of parsed.data.submission) {
    const seconds = Number(item.timestamp);
    // A malformed timestamp means we can't reason about this list at all — fail the whole call
    // rather than silently skip an entry that might have been the one that mattered.
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new LeetCodeProviderError('Unexpected Alfa submission timestamp');
    }
    // The endpoint is documented as Accepted-only; enforce it anyway.
    if (item.statusDisplay !== 'Accepted') continue;
    submissions.push({
      title: item.title,
      titleSlug: item.titleSlug,
      timestamp: seconds * 1000,
      language: item.lang,
    });
  }
  return { submissions, limit };
};

interface CacheEntry {
  value: AcceptedSubmissionsResult;
  expiresAt: number;
}

// Short-lived, success-only cache so the manual button and the background sweep don't hammer the
// provider when they hit the same user back to back.
const submissionsCache = new Map<string, CacheEntry>();

export const clearLeetCodeCache = (): void => {
  submissionsCache.clear();
  blockedUntil = 0;
};

export const leetCodeClient: LeetCodeClient = {
  async getProfile(username) {
    const payload = await getJson(`/${assertUsername(username)}`);
    return parseProfile(payload);
  },

  async getAcceptedSubmissions(username, limit = env.LEETCODE_SUBMISSIONS_LIMIT) {
    const safeName = assertUsername(username);
    const key = `${username.toLowerCase()}:${limit}`;
    const cached = submissionsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const payload = await getJson(`/${safeName}/acSubmission?limit=${Math.trunc(limit)}`);
    const value = parseAcceptedSubmissions(payload, limit);
    submissionsCache.set(key, {
      value,
      expiresAt: Date.now() + env.LEETCODE_CACHE_TTL_SECONDS * 1000,
    });
    return value;
  },
};
