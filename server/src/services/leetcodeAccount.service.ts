import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { LeetCodeProviderError, leetCodeClient } from '../integrations/leetcode/leetcode.client.js';
import { LeetCodeChallenge } from '../models/leetcodeChallenge.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { isDuplicateKeyError } from '../utils/mongo.js';
import { AuthResponseUser, formatUserResponse } from './auth.service.js';
import { assertNoActiveCommitment } from './leetcodeRequirement.service.js';

// Account ownership: the user pastes a one-time token into their LeetCode profile About field and
// we read it back through the (unofficial, see leetcode.client.ts) profile endpoint. Never involves
// a password, cookie or session of theirs.

const TOKEN_PREFIX = 'DSA-VERIFY-';
const TOKEN_BODY_LENGTH = 32;
// An exact token, not a substring of a longer run of token-like characters.
const TOKEN_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_-])${TOKEN_PREFIX}[a-f0-9]{${TOKEN_BODY_LENGTH}}(?![A-Za-z0-9_-])`,
  'g'
);

const normalizeUsername = (username: string): string => username.trim().toLowerCase();
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface LeetCodeChallengeDto {
  username: string;
  token: string;
  expiresAt: Date;
  instructions: string[];
}

const accountInUse = (): ApiError =>
  ApiError.conflict(
    'LEETCODE_ACCOUNT_IN_USE',
    'That LeetCode account is already linked to another CommitDSA user.'
  );

const unavailable = (): ApiError =>
  ApiError.serviceUnavailable(
    'LEETCODE_UNAVAILABLE',
    "We couldn't reach LeetCode to check your profile. Nothing was changed — please try again in a moment."
  );

export class LeetCodeAccountService {
  /** Issues a fresh challenge bound to the authenticated user and username, replacing any earlier
   *  one. Does not mark anything verified. */
  static async createChallenge(
    userId: string,
    rawUsername: string,
    now: Date = new Date()
  ): Promise<LeetCodeChallengeDto> {
    const username = normalizeUsername(rawUsername);
    const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BODY_LENGTH / 2).toString('hex')}`;
    const expiresAt = new Date(now.getTime() + env.LEETCODE_CHALLENGE_TTL_MINUTES * 60_000);

    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User profile not found');

    // Switching to a different account drops the old verification straight away; the new one has
    // to earn it. Completions already recorded are untouched.
    if (user.leetcodeUsername && normalizeUsername(user.leetcodeUsername) !== username) {
      await assertNoActiveCommitment(userId);
      await User.updateOne(
        { _id: user._id },
        { $unset: { leetcodeUsername: 1, leetcodeVerifiedAt: 1, leetcodeUsernameKey: 1 } }
      );
    }

    // Upsert on the unique userId index: one outstanding challenge, atomically replaced.
    await LeetCodeChallenge.findOneAndUpdate(
      { userId: user._id },
      { $set: { username, tokenHash: hashToken(token), expiresAt, consumedAt: null } },
      { upsert: true }
    );

    return {
      username,
      token,
      expiresAt,
      instructions: [
        'Open your LeetCode profile settings and edit the About / README field.',
        `Paste ${token} into it and save.`,
        `Come back here and press Verify ownership within ${env.LEETCODE_CHALLENGE_TTL_MINUTES} minutes.`,
        'Once verified you can delete the token from your profile.',
      ],
    };
  }

  static async verifyChallenge(
    userId: string,
    rawUsername: string,
    now: Date = new Date()
  ): Promise<AuthResponseUser> {
    const username = normalizeUsername(rawUsername);

    const challenge = await LeetCodeChallenge.findOne({ userId, username });
    if (!challenge) {
      throw ApiError.badRequest(
        'LEETCODE_CHALLENGE_NOT_FOUND',
        'No active challenge for that username. Generate a new one first.'
      );
    }
    if (challenge.consumedAt) {
      throw ApiError.badRequest(
        'LEETCODE_CHALLENGE_USED',
        'That challenge was already used. Generate a new one to connect again.'
      );
    }
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      throw ApiError.badRequest(
        'LEETCODE_CHALLENGE_EXPIRED',
        'That challenge has expired. Generate a new one.'
      );
    }

    // A provider failure or unreadable response never consumes the challenge or counts against
    // the user — it is surfaced as retryable.
    let profile;
    try {
      profile = await leetCodeClient.getProfile(username);
    } catch (error) {
      if (!(error instanceof LeetCodeProviderError)) throw error;
      console.error('[LeetCodeAccount] profile lookup failed', {
        user: userId,
        reason: error.message,
      });
      throw unavailable();
    }
    if (!profile) {
      throw ApiError.notFound(
        'LEETCODE_USERNAME_NOT_FOUND',
        "We couldn't find that LeetCode username. Please check it and try again."
      );
    }
    // Defence in depth: the provider must have answered for the account we asked about.
    if (normalizeUsername(profile.username) !== username) {
      console.error('[LeetCodeAccount] profile username mismatch', { user: userId });
      throw unavailable();
    }

    const expected = Buffer.from(challenge.tokenHash, 'hex');
    const found = (profile.about.match(TOKEN_PATTERN) ?? []).some((candidate) => {
      const actual = Buffer.from(hashToken(candidate), 'hex');
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
    if (!found) {
      throw ApiError.badRequest(
        'LEETCODE_CHALLENGE_NOT_IN_PROFILE',
        "We couldn't find the challenge in your LeetCode About field. Save it there and try again."
      );
    }

    // One LeetCode account, one user. Checked before consuming the challenge so a refusal here
    // doesn't burn it; the unique index below still catches a concurrent race.
    if (await User.exists({ leetcodeUsernameKey: username, _id: { $ne: userId } })) {
      throw accountInUse();
    }

    // Atomic consume: of any concurrent verifications, exactly one wins.
    const consumed = await LeetCodeChallenge.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, expiresAt: { $gt: now } },
      { $set: { consumedAt: now } }
    );
    if (!consumed) {
      throw ApiError.badRequest(
        'LEETCODE_CHALLENGE_USED',
        'That challenge was already used. Generate a new one to connect again.'
      );
    }

    let user;
    try {
      user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            leetcodeUsername: profile.username,
            leetcodeVerifiedAt: now,
            leetcodeUsernameKey: username,
          },
        },
        { new: true }
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) throw accountInUse();
      throw error;
    }
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User profile not found');
    return formatUserResponse(user);
  }

  /** Disconnects the account. Completions already recorded keep their evidence. */
  static async disconnect(userId: string): Promise<AuthResponseUser> {
    await assertNoActiveCommitment(userId);
    const user = await User.findByIdAndUpdate(
      userId,
      { $unset: { leetcodeUsername: 1, leetcodeVerifiedAt: 1, leetcodeUsernameKey: 1 } },
      { new: true }
    );
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User profile not found');
    await LeetCodeChallenge.deleteOne({ userId });
    return formatUserResponse(user);
  }
}
