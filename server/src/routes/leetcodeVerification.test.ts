import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../integrations/leetcode/leetcode.client.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../integrations/leetcode/leetcode.client.js')>();
  return {
    ...original,
    getLeetCodeProviderStatus: vi.fn(original.getLeetCodeProviderStatus),
    leetCodeClient: { getProfile: vi.fn(), getAcceptedSubmissions: vi.fn() },
  };
});

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import {
  LeetCodeProviderError,
  getLeetCodeProviderStatus,
  leetCodeClient,
} from '../integrations/leetcode/leetcode.client.js';
import { runLeetCodeVerificationSweep } from '../jobs/leetcodeVerification.job.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { LeetCodeChallenge } from '../models/leetcodeChallenge.model.js';
import { Plan } from '../models/plan.model.js';
import { IProblem, Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { CommitmentService } from '../services/commitment.service.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import {
  LeetCodeVerificationService,
  isLeetCodeConfigured,
} from '../services/leetcodeVerification.service.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const mockGetProfile = vi.mocked(leetCodeClient.getProfile);
const mockGetSubmissions = vi.mocked(leetCodeClient.getAcceptedSubmissions);

const TEST_DB = 'commit_dsa_test_leetcode';

const buildTestUri = (baseUri: string): string => {
  const match = baseUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
  return match
    ? `${match[1]}/${TEST_DB}${match[2] ?? ''}`
    : `${baseUri.replace(/\/$/, '')}/${TEST_DB}`;
};

describe('LeetCode integration', () => {
  const app = createApp();
  const IST = '+05:30';
  // Day 1 is 2031-02-10 in Asia/Kolkata — the local day activation lands on.
  const day1 = new Date(`2031-02-10T12:00:00${IST}`);
  const day1Start = new Date(`2031-02-10T00:00:00${IST}`).getTime();
  const HOUR = 60 * 60 * 1000;

  let counter = 0;
  const register = async (label: string): Promise<{ id: string; cookie: string }> => {
    counter += 1;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: `LC ${label}`,
        email: `lc-${label}-${Date.now()}-${counter}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(res.status).toBe(201);
    return { id: res.body.data.user.id, cookie: extractAuthCookie(res) };
  };

  const sub = (slug: string, offsetMs: number) => ({
    title: slug,
    titleSlug: slug,
    timestamp: day1Start + offsetMs,
  });
  const submissions = (...items: ReturnType<typeof sub>[]) => ({ submissions: items, limit: 20 });

  beforeAll(async () => {
    await mongoose.connect(buildTestUri(env.MONGODB_URI));
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      Commitment.init(),
      DailyProgress.init(),
      Plan.init(),
      Problem.init(),
      LeetCodeChallenge.init(),
    ]);
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(() => {
    mockGetProfile.mockReset();
    mockGetSubmissions.mockReset();
  });

  describe('account ownership', () => {
    const challenge = (cookie: string, username: string) =>
      request(app)
        .post('/api/integrations/leetcode/challenge')
        .set({ Cookie: cookie })
        .send({ username });
    const verify = (cookie: string, username: string) =>
      request(app)
        .post('/api/integrations/leetcode/verify')
        .set({ Cookie: cookie })
        .send({ username });
    const profile = (username: string, about: string) => ({ username, about });

    it('requires authentication and a valid username', async () => {
      const anon = await request(app)
        .post('/api/integrations/leetcode/challenge')
        .send({ username: 'abc' });
      expect(anon.status).toBe(401);

      const { cookie } = await register('validation');
      for (const bad of ['', 'a/b', '../x', 'a b', 'x'.repeat(51)]) {
        const res = await challenge(cookie, bad);
        expect(res.status).toBe(400);
      }
    });

    it('issues a challenge for the authenticated user only, storing just a hash', async () => {
      const { id, cookie } = await register('issue');
      const other = await register('issue-other');
      // A user id in the body must not change whose challenge this is.
      const res = await request(app)
        .post('/api/integrations/leetcode/challenge')
        .set({ Cookie: cookie })
        .send({ username: 'IssueUser', userId: other.id });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toMatch(/^DSA-VERIFY-[a-f0-9]{32}$/);
      expect(res.body.data.username).toBe('issueuser');

      const stored = await LeetCodeChallenge.findOne({ userId: id });
      expect(stored).not.toBeNull();
      expect(stored!.tokenHash).not.toContain(res.body.data.token);
      expect(await LeetCodeChallenge.countDocuments({ userId: other.id })).toBe(0);
      // Issuing a challenge never marks the account verified.
      expect((await User.findById(id))?.leetcodeVerifiedAt).toBeUndefined();
    });

    it('verifies when the exact token is in the About field, and exposes no internals', async () => {
      const { id, cookie } = await register('valid');
      const { body } = await challenge(cookie, 'ValidUser');
      mockGetProfile.mockResolvedValue(profile('ValidUser', `hello ${body.data.token}\nbye`));

      const res = await verify(cookie, 'validuser');

      expect(res.status).toBe(200);
      expect(res.body.data.leetcodeUsername).toBe('ValidUser');
      expect(res.body.data.leetcodeVerifiedAt).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toContain('tokenHash');
      const user = await User.findById(id);
      expect(user?.leetcodeUsername).toBe('ValidUser');
      expect(user?.leetcodeVerifiedAt).toBeInstanceOf(Date);
    });

    it('rejects when the challenge is absent from the profile, without consuming it', async () => {
      const { cookie } = await register('absent');
      const { body } = await challenge(cookie, 'absentuser');
      mockGetProfile.mockResolvedValue(profile('absentuser', 'nothing here'));

      const res = await verify(cookie, 'absentuser');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEETCODE_CHALLENGE_NOT_IN_PROFILE');

      // The user fixes their profile and retries with the same challenge.
      mockGetProfile.mockResolvedValue(profile('absentuser', body.data.token));
      expect((await verify(cookie, 'absentuser')).status).toBe(200);
    });

    it('does not accept a similar but non-identical token', async () => {
      const { cookie } = await register('similar');
      const { body } = await challenge(cookie, 'similaruser');
      const token: string = body.data.token;
      const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
      const cases = [
        flipped, // one character different
        `${token}a`, // longer token-like run
        `x${token}`, // prefixed run
        token.slice(0, -1), // truncated
        token.toLowerCase().replace('dsa-verify-', 'dsa-verify '), // mangled prefix
      ];
      for (const about of cases) {
        mockGetProfile.mockResolvedValue(profile('similaruser', about));
        const res = await verify(cookie, 'similaruser');
        expect(res.status, about).toBe(400);
        expect(res.body.error.code).toBe('LEETCODE_CHALLENGE_NOT_IN_PROFILE');
      }
    });

    it('rejects an expired challenge', async () => {
      const { id, cookie } = await register('expired');
      const { body } = await challenge(cookie, 'expireduser');
      await LeetCodeChallenge.updateOne(
        { userId: id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );
      mockGetProfile.mockResolvedValue(profile('expireduser', body.data.token));

      const res = await verify(cookie, 'expireduser');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEETCODE_CHALLENGE_EXPIRED');
      expect(mockGetProfile).not.toHaveBeenCalled();
    });

    it("cannot use another user's challenge, or a challenge for a different username", async () => {
      const owner = await register('owner');
      const thief = await register('thief');
      const { body } = await challenge(owner.cookie, 'sharedname');
      mockGetProfile.mockResolvedValue(profile('sharedname', body.data.token));

      const stolen = await verify(thief.cookie, 'sharedname');
      expect(stolen.status).toBe(400);
      expect(stolen.body.error.code).toBe('LEETCODE_CHALLENGE_NOT_FOUND');

      const wrongName = await verify(owner.cookie, 'someoneelse');
      expect(wrongName.status).toBe(400);
      expect(wrongName.body.error.code).toBe('LEETCODE_CHALLENGE_NOT_FOUND');
      expect((await User.findById(thief.id))?.leetcodeVerifiedAt).toBeUndefined();
    });

    it('treats a provider failure as retryable and neither consumes the challenge nor verifies', async () => {
      const { id, cookie } = await register('timeout');
      const { body } = await challenge(cookie, 'timeoutuser');
      mockGetProfile.mockRejectedValueOnce(new LeetCodeProviderError('timeout'));

      const failed = await verify(cookie, 'timeoutuser');
      expect(failed.status).toBe(503);
      expect(failed.body.error.code).toBe('LEETCODE_UNAVAILABLE');
      expect(JSON.stringify(failed.body)).not.toContain('timeout');
      expect((await LeetCodeChallenge.findOne({ userId: id }))?.consumedAt).toBeNull();
      expect((await User.findById(id))?.leetcodeVerifiedAt).toBeUndefined();

      mockGetProfile.mockResolvedValue(profile('timeoutuser', body.data.token));
      expect((await verify(cookie, 'timeoutuser')).status).toBe(200);
    });

    it('cannot reuse a consumed challenge, and concurrent verifications consume it once', async () => {
      const { cookie } = await register('reuse');
      const { body } = await challenge(cookie, 'reuseuser');
      mockGetProfile.mockResolvedValue(profile('reuseuser', body.data.token));

      const results = await Promise.all([verify(cookie, 'reuseuser'), verify(cookie, 'reuseuser')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(results.find((r) => r.status === 400)?.body.error.code).toBe(
        'LEETCODE_CHALLENGE_USED'
      );

      const again = await verify(cookie, 'reuseuser');
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('LEETCODE_CHALLENGE_USED');
    });

    it('a new challenge invalidates the previous outstanding one', async () => {
      const { cookie } = await register('replace');
      const first = await challenge(cookie, 'replaceuser');
      await challenge(cookie, 'replaceuser');
      mockGetProfile.mockResolvedValue(profile('replaceuser', first.body.data.token));

      const res = await verify(cookie, 'replaceuser');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEETCODE_CHALLENGE_NOT_IN_PROFILE');
    });

    it('drops the old verification when the username changes, until the new one is proven', async () => {
      const { id, cookie } = await register('switch');
      const first = await challenge(cookie, 'oldname');
      mockGetProfile.mockResolvedValue(profile('oldname', first.body.data.token));
      expect((await verify(cookie, 'oldname')).status).toBe(200);

      await challenge(cookie, 'newname');
      const user = await User.findById(id);
      expect(user?.leetcodeUsername).toBeUndefined();
      expect(user?.leetcodeVerifiedAt).toBeUndefined();
      await expect(
        LeetCodeVerificationService.verifyToday(id, new mongoose.Types.ObjectId().toString(), day1)
      ).rejects.toMatchObject({ code: 'LEETCODE_NOT_CONNECTED' });
    });

    it('can be disconnected', async () => {
      const { id, cookie } = await register('disconnect');
      const { body } = await challenge(cookie, 'disconnectuser');
      mockGetProfile.mockResolvedValue(profile('disconnectuser', body.data.token));
      await verify(cookie, 'disconnectuser');

      const res = await request(app).delete('/api/integrations/leetcode').set({ Cookie: cookie });
      expect(res.status).toBe(200);
      expect(res.body.data.leetcodeUsername).toBeNull();
      expect((await User.findById(id))?.leetcodeVerifiedAt).toBeUndefined();
    });

    it('rate-limits excessive challenge generation', async () => {
      const { cookie } = await register('ratelimit');
      const statuses: number[] = [];
      for (let i = 0; i < env.LEETCODE_CHALLENGE_RATE_LIMIT + 1; i += 1) {
        statuses.push((await challenge(cookie, 'ratelimituser')).status);
      }
      expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    });
  });

  describe('problem verification', () => {
    let twoSumId: string;
    let reverseStringId: string;
    let validParenthesesId: string;
    let userId: string;
    let cookie: string;
    let commitmentId: string;
    let strangerId: string;

    const txnCount = () => CommitmentTransaction.countDocuments({ commitmentId });
    const dayRow = () => DailyProgress.findOne({ commitmentId, dayNumber: 1 });

    beforeAll(async () => {
      const problems = await Problem.insertMany(
        [
          ['Two Sum', 'two-sum'],
          ['Reverse String', 'reverse-string'],
          ['Valid Parentheses', 'valid-parentheses'],
        ].map(([title, slug], index) => ({
          title,
          slug,
          difficulty: 'Easy',
          topic: 'Test',
          url: `https://leetcode.com/problems/${slug}/`,
          source: 'LeetCode',
          order: index + 1,
        }))
      );
      [twoSumId, reverseStringId, validParenthesesId] = problems.map((p) => p._id.toString());

      // 7 days at 3/day = 21 slots; only day 1 matters here.
      const filler = await Problem.insertMany(
        Array.from({ length: 18 }, (_, i) => ({
          title: `Filler ${i + 1}`,
          slug: `lc-filler-${i + 1}`,
          difficulty: 'Easy',
          topic: 'Test',
          url: `https://leetcode.com/problems/lc-filler-${i + 1}/`,
          source: 'LeetCode',
          order: i + 4,
        }))
      );
      const plan = await Plan.create({
        name: 'LeetCode Test Plan',
        slug: 'lc-test-plan',
        description: 'Plan for LeetCode verification tests',
        problemIds: [...problems.map((p) => p._id), ...filler.map((p) => p._id)],
        order: 0,
      });

      ({ id: userId, cookie } = await register('verifier'));
      // Starting a LeetCode-verified commitment requires a verified account.
      await User.updateOne(
        { _id: userId },
        { $set: { leetcodeUsername: 'verifier', leetcodeVerifiedAt: new Date() } }
      );
      const created = await CommitmentService.create(userId, {
        planId: plan._id.toString(),
        dailyTarget: 3,
        depositAmount: 1000,
      });
      commitmentId = created.id;
      await CommitmentService.activateForDev(
        userId,
        commitmentId,
        new Date(`2031-02-10T10:00:00${IST}`)
      );

      const today = await DailyProgressService.getToday(userId, commitmentId, day1);
      expect(today.today?.problems.map((p) => p.id)).toEqual([
        twoSumId,
        reverseStringId,
        validParenthesesId,
      ]);

      ({ id: strangerId } = await register('stranger'));
      await User.updateOne(
        { _id: strangerId },
        { $set: { leetcodeUsername: 'stranger', leetcodeVerifiedAt: new Date() } }
      );
    });

    it('requires authentication on the endpoint', async () => {
      const res = await request(app).post(`/api/commitments/${commitmentId}/verify-today`);
      expect(res.status).toBe(401);
      expect(cookie).toBeTruthy();
    });

    it('cannot proceed without a verified LeetCode account', async () => {
      await User.updateOne(
        { _id: userId },
        { $unset: { leetcodeUsername: 1, leetcodeVerifiedAt: 1 } }
      );
      await expect(
        LeetCodeVerificationService.verifyToday(userId, commitmentId, day1)
      ).rejects.toMatchObject({ code: 'LEETCODE_NOT_CONNECTED' });

      // A bare username with no ownership proof (e.g. saved before verification existed) is ignored.
      await User.updateOne({ _id: userId }, { $set: { leetcodeUsername: 'legacy' } });
      await expect(
        LeetCodeVerificationService.verifyToday(userId, commitmentId, day1)
      ).rejects.toMatchObject({ code: 'LEETCODE_NOT_CONNECTED' });
      expect(mockGetSubmissions).not.toHaveBeenCalled();

      await User.updateOne(
        { _id: userId },
        { $set: { leetcodeUsername: 'verifier', leetcodeVerifiedAt: new Date() } }
      );
    });

    it("rejects another user's commitment", async () => {
      await expect(
        LeetCodeVerificationService.verifyToday(strangerId, commitmentId, day1)
      ).rejects.toBeTruthy();
      expect(mockGetSubmissions).not.toHaveBeenCalled();
      expect((await dayRow())?.problemCompletions).toHaveLength(0);
    });

    it('provider outage: retryable result, nothing missed, no money movement', async () => {
      const before = await txnCount();
      mockGetSubmissions.mockRejectedValue(new LeetCodeProviderError('down'));

      const result = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);

      expect(result.providerAvailable).toBe(false);
      expect(result.problems.map((p) => p.status)).toEqual(
        Array(3).fill('TEMPORARILY_UNAVAILABLE')
      );
      expect((await dayRow())?.status).toBe('PENDING');
      expect((await Commitment.findById(commitmentId))?.missedDays).toBe(0);
      expect(await txnCount()).toBe(before);
    });

    it('does not credit a different slug, a non-window submission, or a problem not assigned today', async () => {
      mockGetSubmissions.mockResolvedValue(
        submissions(
          sub('contains-duplicate', HOUR), // some other problem entirely
          sub('lc-filler-1', HOUR), // in our DB, but assigned to a later day
          sub('two-sum', -HOUR), // right problem, day before
          sub('reverse-string', 24 * HOUR + 1000) // right problem, day after
        )
      );

      const result = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);

      expect(result.verifiedProblemIds).toEqual([]);
      expect(result.problems.map((p) => p.status)).toEqual(Array(3).fill('PENDING'));
      expect((await dayRow())?.problemCompletions).toHaveLength(0);
    });

    it('reports indeterminate when a full page may have hidden an earlier solve', async () => {
      // 20 entries (the provider's cap), all inside today's window, none matching: older ones may exist.
      mockGetSubmissions.mockResolvedValue(
        submissions(...Array.from({ length: 20 }, (_, i) => sub(`other-${i}`, (20 - i) * 1000)))
      );
      const truncated = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);
      expect(
        truncated.problems.every((p) => p.status === 'PENDING' && p.reason === 'history_truncated')
      ).toBe(true);

      // Same page size, but it reaches back before the window: absence is conclusive for today.
      mockGetSubmissions.mockResolvedValue(
        submissions(
          ...Array.from({ length: 19 }, (_, i) => sub(`other-${i}`, (19 - i) * 1000)),
          sub('older', -HOUR)
        )
      );
      const complete = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);
      expect(complete.problems.every((p) => p.reason === 'no_matching_submission')).toBe(true);
      expect((await dayRow())?.status).toBe('PENDING');
    });

    it('verifies only the matching assigned problem, with auditable evidence, once', async () => {
      mockGetSubmissions.mockResolvedValue(
        submissions(
          sub('two-sum', 2 * HOUR), // later duplicate
          sub('two-sum', HOUR) // earliest qualifying one is the evidence
        )
      );
      // Provider lists newest first.
      const result = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);

      expect(result.verifiedProblemIds).toEqual([twoSumId]);
      expect(result.dayCompleted).toBe(false);
      expect(Object.fromEntries(result.problems.map((p) => [p.slug, p.status]))).toEqual({
        'two-sum': 'VERIFIED',
        'reverse-string': 'PENDING',
        'valid-parentheses': 'PENDING',
      });

      const row = await dayRow();
      expect(row?.problemCompletions).toHaveLength(1);
      expect(row?.completedProblems).toBe(1);
      expect(row?.status).toBe('PENDING'); // 1 / 3 — the day is not complete
      const completion = row!.problemCompletions[0];
      expect(completion.method).toBe('LEETCODE');
      expect(completion.leetcodeEvidence).toMatchObject({
        titleSlug: 'two-sum',
        timestamp: day1Start + HOUR,
      });
      expect(completion.leetcodeEvidence?.verifiedAt).toBeInstanceOf(Date);
      expect(completion.leetcodeEvidence?.submissionId).toBeUndefined(); // provider supplies none
    });

    it('is idempotent across repeated manual checks and worker sweeps', async () => {
      mockGetSubmissions.mockResolvedValue(submissions(sub('two-sum', HOUR)));

      const again = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);
      expect(again.verifiedProblemIds).toEqual([]);
      await runLeetCodeVerificationSweep(day1);
      await runLeetCodeVerificationSweep(day1);

      const row = await dayRow();
      expect(row?.problemCompletions).toHaveLength(1);
      expect(row?.completedProblems).toBe(1);
      expect((await Commitment.findById(commitmentId))?.completedDays).toBe(0);
    });

    it('completes the day, streak and attendance only once every assigned problem is verified', async () => {
      const before = await txnCount();
      mockGetSubmissions.mockResolvedValue(
        submissions(sub('valid-parentheses', 3 * HOUR), sub('reverse-string', 2 * HOUR))
      );

      const result = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);

      expect(result.verifiedProblemIds.sort()).toEqual(
        [reverseStringId, validParenthesesId].sort()
      );
      expect(result.dayCompleted).toBe(true);
      const row = await dayRow();
      expect(row?.status).toBe('COMPLETED');
      expect(row?.completedProblems).toBe(3);

      const commitment = await Commitment.findById(commitmentId);
      expect(commitment?.completedDays).toBe(1);
      expect(commitment?.currentStreak).toBe(1);
      expect(commitment?.missedDays).toBe(0);
      expect(await txnCount()).toBe(before); // verification never creates ledger rows

      // Running everything again changes nothing.
      await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);
      await runLeetCodeVerificationSweep(day1);
      expect((await Commitment.findById(commitmentId))?.completedDays).toBe(1);
      expect((await dayRow())?.problemCompletions).toHaveLength(3);
    });
  });

  describe('problem configuration', () => {
    const make = (over: Partial<IProblem>): IProblem =>
      ({
        slug: 'two-sum',
        source: 'LeetCode',
        url: 'https://leetcode.com/problems/two-sum/',
        ...over,
      }) as IProblem;

    it('accepts a canonical LeetCode problem', () => {
      expect(isLeetCodeConfigured(make({}))).toBe(true);
      expect(
        isLeetCodeConfigured(make({ url: 'https://leetcode.com/problems/two-sum/description/' }))
      ).toBe(true);
    });

    it('rejects a missing, malformed or mismatched slug/url', () => {
      expect(isLeetCodeConfigured(make({ slug: '' }))).toBe(false);
      expect(isLeetCodeConfigured(make({ slug: 'Two Sum' }))).toBe(false);
      expect(isLeetCodeConfigured(make({ url: 'https://example.com/problems/two-sum/' }))).toBe(
        false
      );
      expect(
        isLeetCodeConfigured(make({ url: 'https://leetcode.com/problems/valid-parentheses/' }))
      ).toBe(false);
      expect(isLeetCodeConfigured(make({ url: 'not a url' }))).toBe(false);
      expect(isLeetCodeConfigured(make({ source: 'Other' }))).toBe(false);
    });
  });
});

describe('LeetCode requirement to start a commitment', () => {
  const app = createApp();
  let cookie: string;
  let userId: string;
  let planId: string;
  let judgePlanId: string;

  const create = (planId: string) =>
    request(app)
      .post('/api/commitments')
      .set({ Cookie: cookie })
      .send({ planId, dailyTarget: 1, depositAmount: 500 });

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(buildTestUri(env.MONGODB_URI));
    }
    const lc = await Problem.create({
      title: 'Gate LC',
      slug: 'gate-lc',
      difficulty: 'Easy',
      topic: 'Test',
      url: 'https://leetcode.com/problems/gate-lc/',
      source: 'LeetCode',
      order: 900,
    });
    const own = await Problem.create({
      title: 'Gate Own',
      slug: 'gate-own',
      difficulty: 'Easy',
      topic: 'Test',
      url: 'https://example.com/gate-own',
      source: 'LeetCode',
      judgeEnabled: true,
      order: 901,
    });
    planId = (
      await Plan.create({
        name: 'Gate LC',
        slug: 'gate-lc',
        description: 'x',
        problemIds: [lc._id],
        order: 900,
      })
    )._id.toString();
    judgePlanId = (
      await Plan.create({
        name: 'Gate Own',
        slug: 'gate-own',
        description: 'x',
        problemIds: [own._id],
        order: 901,
      })
    )._id.toString();

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Gate',
        email: `gate-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    userId = res.body.data.user.id;
    cookie = extractAuthCookie(res);
  });

  it('flags which plans need LeetCode', async () => {
    const res = await request(app).get('/api/plans').set({ Cookie: cookie });
    const bySlug = Object.fromEntries(res.body.data.map((p: { slug: string }) => [p.slug, p]));
    expect(bySlug['gate-lc'].requiresLeetCode).toBe(true);
    expect(bySlug['gate-own'].requiresLeetCode).toBe(false);
  });

  it('blocks creating a LeetCode-verified commitment until the account is verified', async () => {
    const res = await create(planId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LEETCODE_VERIFICATION_REQUIRED');
    expect(await Commitment.countDocuments({ userId })).toBe(0);

    // A bare, unproven username does not count.
    await User.updateOne({ _id: userId }, { $set: { leetcodeUsername: 'gate' } });
    expect((await create(planId)).status).toBe(403);
  });

  it('does not require LeetCode for plans checked in our own editor', async () => {
    const res = await create(judgePlanId);
    expect(res.status).toBe(201);
    await Commitment.deleteMany({ userId });
  });

  it('allows it once verified, and blocks disconnect / account change while active', async () => {
    await User.updateOne(
      { _id: userId },
      { $set: { leetcodeUsername: 'gate', leetcodeVerifiedAt: new Date() } }
    );
    const created = await create(planId);
    expect(created.status).toBe(201);

    // Pending payment: the account can still be changed.
    // Unverify before paying -> activation is refused.
    await User.updateOne({ _id: userId }, { $unset: { leetcodeVerifiedAt: 1 } });
    const blocked = await request(app)
      .post(`/api/commitments/${created.body.data.id}/dev-activate`)
      .set({ Cookie: cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LEETCODE_VERIFICATION_REQUIRED');

    await User.updateOne({ _id: userId }, { $set: { leetcodeVerifiedAt: new Date() } });
    const active = await request(app)
      .post(`/api/commitments/${created.body.data.id}/dev-activate`)
      .set({ Cookie: cookie });
    expect(active.status).toBe(200);

    const disconnect = await request(app)
      .delete('/api/integrations/leetcode')
      .set({ Cookie: cookie });
    expect(disconnect.status).toBe(409);
    expect(disconnect.body.error.code).toBe('LEETCODE_LOCKED_BY_COMMITMENT');

    const change = await request(app)
      .post('/api/integrations/leetcode/challenge')
      .set({ Cookie: cookie })
      .send({ username: 'someoneelse' });
    expect(change.status).toBe(409);
    expect((await User.findById(userId))?.leetcodeVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects the manual tick for LeetCode problems once the account is verified', async () => {
    const res = await request(app).post(`/api/commitments`).set({ Cookie: cookie });
    expect(res.status).toBeGreaterThanOrEqual(400); // active commitment already exists

    const active = await Commitment.findOne({ userId, status: 'ACTIVE' });
    const problem = await Problem.findOne({ slug: 'gate-lc' });
    await expect(
      DailyProgressService.setProblemCompletion(userId, active!._id.toString(), {
        problemId: problem!._id.toString(),
        completed: true,
      })
    ).rejects.toMatchObject({ code: 'LEETCODE_VERIFICATION_ONLY' });
  });
});

describe('verification grace before a day is marked missed', () => {
  const app = createApp();
  const IST = '+05:30';
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  // Day 1 = 2031-03-10 (IST); its deadline is 23:59:59.999 that night.
  const day1Noon = new Date(`2031-03-10T12:00:00${IST}`);
  const day1Start = new Date(`2031-03-10T00:00:00${IST}`).getTime();
  const midnight = new Date(`2031-03-11T00:00:00${IST}`).getTime();
  const after = (ms: number) => new Date(midnight + ms);

  let counter = 0;
  const setup = async () => {
    counter += 1;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Grace',
        email: `grace-${Date.now()}-${counter}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    const userId: string = res.body.data.user.id;
    await User.updateOne(
      { _id: userId },
      { $set: { leetcodeUsername: `grace${counter}`, leetcodeVerifiedAt: new Date() } }
    );
    await Commitment.deleteMany({ userId });

    const problems = await Problem.insertMany(
      ['a', 'b'].map((x, i) => ({
        title: `Grace ${x}${counter}`,
        slug: `grace-${x}${counter}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://leetcode.com/problems/grace-${x}${counter}/`,
        source: 'LeetCode',
        order: 1000 + counter * 2 + i,
      }))
    );
    const plan = await Plan.create({
      name: `Grace ${counter}`,
      slug: `grace-plan-${counter}`,
      description: 'x',
      problemIds: problems.map((p) => p._id),
      order: 1000 + counter,
    });
    // 2 problems at 1/day = 2 days.
    const created = await CommitmentService.create(userId, {
      planId: plan._id.toString(),
      dailyTarget: 1,
      depositAmount: 1000,
    });
    await CommitmentService.activateForDev(userId, created.id, day1Noon);
    return { userId, commitmentId: created.id, slug: problems[0].slug };
  };

  const day1 = (commitmentId: string) => DailyProgress.findOne({ commitmentId, dayNumber: 1 });
  const forfeitures = (commitmentId: string) =>
    CommitmentTransaction.countDocuments({ commitmentId, type: 'FORFEITURE' });

  beforeEach(() => {
    mockGetSubmissions.mockReset();
  });

  it('holds back MISSED during the grace window, then marks it after a conclusive check', async () => {
    const { commitmentId } = await setup();
    // The sweep checked after the deadline, reached the provider, and found nothing.
    await DailyProgress.updateOne(
      { commitmentId, dayNumber: 1 },
      {
        $set: {
          lastVerification: {
            checkedAt: new Date(midnight + 5 * MIN),
            inconclusive: false,
            providerUnavailable: false,
          },
        },
      }
    );
    const commitment = (await Commitment.findById(commitmentId))!;

    await DailyProgressService.reconcile(commitment, after(10 * MIN));
    expect((await day1(commitmentId))?.status).toBe('PENDING');
    expect(await forfeitures(commitmentId)).toBe(0);

    await DailyProgressService.reconcile(commitment, after(31 * MIN));
    expect((await day1(commitmentId))?.status).toBe('MISSED');
    expect(await forfeitures(commitmentId)).toBe(1);
  });

  it('never marks a day missed when nothing has checked it since the deadline (e.g. the sweep was down)', async () => {
    const { commitmentId } = await setup();
    const commitment = (await Commitment.findById(commitmentId))!;

    for (const elapsed of [31 * MIN, 7 * HOUR, 30 * HOUR]) {
      await DailyProgressService.reconcile(commitment, after(elapsed));
      expect((await day1(commitmentId))?.status, `${elapsed / HOUR}h`).toBe('PENDING');
    }
    expect(await forfeitures(commitmentId)).toBe(0);

    // The backstop: it cannot be held forever.
    await DailyProgressService.reconcile(commitment, after(73 * HOUR));
    expect((await day1(commitmentId))?.status).toBe('MISSED');
  });

  it('a check made before the deadline does not count as having verified the day', async () => {
    const { commitmentId } = await setup();
    await DailyProgress.updateOne(
      { commitmentId, dayNumber: 1 },
      {
        $set: {
          lastVerification: {
            checkedAt: new Date(midnight - 2 * MIN),
            inconclusive: false,
            providerUnavailable: false,
          },
        },
      }
    );
    await DailyProgressService.reconcile(
      (await Commitment.findById(commitmentId))!,
      after(2 * HOUR)
    );
    expect((await day1(commitmentId))?.status).toBe('PENDING');
  });

  it('gives no grace to users without a verified account', async () => {
    // Verification is lost after the commitment started (e.g. data repair); no grace without it.
    const { userId, commitmentId } = await setup();
    await User.updateOne(
      { _id: userId },
      { $unset: { leetcodeUsername: 1, leetcodeVerifiedAt: 1 } }
    );
    const commitment = (await Commitment.findById(commitmentId))!;

    await DailyProgressService.reconcile(commitment, after(1 * MIN));
    expect((await day1(commitmentId))?.status).toBe('MISSED');
  });

  it('a truncated history gets only the short cap: waiting cannot bring the missing solve back', async () => {
    const { commitmentId } = await setup();
    await DailyProgress.updateOne(
      { commitmentId, dayNumber: 1 },
      {
        $set: {
          lastVerification: {
            checkedAt: new Date(midnight + MIN),
            inconclusive: true,
            providerUnavailable: false,
          },
        },
      }
    );
    const commitment = (await Commitment.findById(commitmentId))!;

    await DailyProgressService.reconcile(commitment, after(3 * HOUR));
    expect((await day1(commitmentId))?.status).toBe('PENDING');

    await DailyProgressService.reconcile(commitment, after(7 * HOUR));
    expect((await day1(commitmentId))?.status).toBe('MISSED');
  });

  it('a provider outage holds the day open far past the 6 hour cap, up to the backstop', async () => {
    const { commitmentId } = await setup();
    await DailyProgress.updateOne(
      { commitmentId, dayNumber: 1 },
      {
        $set: {
          lastVerification: {
            checkedAt: new Date(midnight + MIN),
            inconclusive: true,
            providerUnavailable: true,
          },
        },
      }
    );
    const commitment = (await Commitment.findById(commitmentId))!;

    for (const elapsed of [7 * HOUR, 30 * HOUR, 71 * HOUR]) {
      await DailyProgressService.reconcile(commitment, after(elapsed));
      expect((await day1(commitmentId))?.status, `${elapsed / HOUR}h`).toBe('PENDING');
    }
    expect(await forfeitures(commitmentId)).toBe(0);

    await DailyProgressService.reconcile(commitment, after(73 * HOUR));
    expect((await day1(commitmentId))?.status).toBe('MISSED');
  });

  it('a solve is found and credited once the provider recovers, hours later, with no forfeiture', async () => {
    const { commitmentId, slug } = await setup();

    // Right after the deadline the provider is down for everyone.
    mockGetSubmissions.mockRejectedValue(new LeetCodeProviderError('down'));
    await runLeetCodeVerificationSweep(after(10 * MIN));
    expect((await day1(commitmentId))?.lastVerification?.providerUnavailable).toBe(true);

    // Still down 10 hours later (past the old 6 hour cap): nothing is decided against the user.
    await runLeetCodeVerificationSweep(after(10 * HOUR));
    await DailyProgressService.reconcile(
      (await Commitment.findById(commitmentId))!,
      after(10 * HOUR)
    );
    expect((await day1(commitmentId))?.status).toBe('PENDING');
    expect(await forfeitures(commitmentId)).toBe(0);

    // It comes back and shows the solve they made inside the day.
    mockGetSubmissions.mockResolvedValue({
      submissions: [{ title: slug, titleSlug: slug, timestamp: midnight - 5 * MIN }],
      limit: 20,
    });
    await runLeetCodeVerificationSweep(after(11 * HOUR));

    expect((await day1(commitmentId))?.status).toBe('COMPLETED');
    expect(await forfeitures(commitmentId)).toBe(0);
    expect((await Commitment.findById(commitmentId))?.missedDays).toBe(0);
  });

  it('after recovery, a user who really did not solve is marked missed promptly', async () => {
    const { commitmentId } = await setup();
    mockGetSubmissions.mockRejectedValue(new LeetCodeProviderError('down'));
    await runLeetCodeVerificationSweep(after(10 * MIN));

    mockGetSubmissions.mockResolvedValue({ submissions: [], limit: 20 });
    await runLeetCodeVerificationSweep(after(11 * HOUR));
    await DailyProgressService.reconcile(
      (await Commitment.findById(commitmentId))!,
      after(11 * HOUR + MIN)
    );

    expect((await day1(commitmentId))?.status).toBe('MISSED');
    expect(await forfeitures(commitmentId)).toBe(1);
  });

  it('the sweep re-checks held days older than yesterday, and checks past-deadline days first', async () => {
    const { commitmentId } = await setup();
    mockGetSubmissions.mockRejectedValue(new LeetCodeProviderError('down'));
    await runLeetCodeVerificationSweep(after(10 * MIN));
    mockGetSubmissions.mockReset().mockResolvedValue({ submissions: [], limit: 20 });

    // Two and a half days later the held day 1 is two days behind "yesterday".
    const later = after(2 * 24 * HOUR + 12 * HOUR);
    await runLeetCodeVerificationSweep(later);

    expect(mockGetSubmissions).toHaveBeenCalled();
    const row = await day1(commitmentId);
    expect(row?.lastVerification?.providerUnavailable).toBe(false);
    expect(row?.lastVerification?.checkedAt.getTime()).toBe(later.getTime());
  });

  it('a solve from inside the day, found during grace, completes it with no forfeiture', async () => {
    const { userId, commitmentId, slug } = await setup();
    mockGetSubmissions.mockResolvedValue({
      submissions: [{ title: slug, titleSlug: slug, timestamp: midnight - 5 * MIN }],
      limit: 20,
    });

    // The sweep runs 10 minutes after midnight.
    await runLeetCodeVerificationSweep(after(10 * MIN));

    const row = await day1(commitmentId);
    expect(row?.status).toBe('COMPLETED');
    expect(row?.completedAt?.getTime()).toBe(midnight - 5 * MIN);
    const commitment = await Commitment.findById(commitmentId);
    expect(commitment?.completedDays).toBe(1);
    expect(commitment?.missedDays).toBe(0);
    expect(await forfeitures(commitmentId)).toBe(0);
    expect(userId).toBeTruthy();
  });

  it('does not credit a solve made after the deadline, even within grace', async () => {
    const { commitmentId, slug } = await setup();
    mockGetSubmissions.mockResolvedValue({
      submissions: [{ title: slug, titleSlug: slug, timestamp: midnight + 2 * MIN }],
      limit: 20,
    });

    await runLeetCodeVerificationSweep(after(10 * MIN));
    expect((await day1(commitmentId))?.status).toBe('PENDING');

    await DailyProgressService.reconcile(
      (await Commitment.findById(commitmentId))!,
      after(31 * MIN)
    );
    expect((await day1(commitmentId))?.status).toBe('MISSED');
    expect(day1Start).toBeLessThan(midnight);
  });

  it('a provider outage during grace records an inconclusive check and still never marks missed early', async () => {
    const { commitmentId } = await setup();
    mockGetSubmissions.mockRejectedValue(new LeetCodeProviderError('down'));

    await runLeetCodeVerificationSweep(after(20 * MIN));
    expect((await day1(commitmentId))?.lastVerification?.inconclusive).toBe(true);

    // Past the base 30 min, but the outage keeps it open.
    await DailyProgressService.reconcile(
      (await Commitment.findById(commitmentId))!,
      after(45 * MIN)
    );
    expect((await day1(commitmentId))?.status).toBe('PENDING');
    expect(await forfeitures(commitmentId)).toBe(0);
  });

  describe('sweep under provider pressure', () => {
    const realStatus = vi.mocked(getLeetCodeProviderStatus).getMockImplementation();
    const status = (remaining: number, extra: Record<string, unknown> = {}) =>
      vi.mocked(getLeetCodeProviderStatus).mockReturnValue({
        state: 'ok',
        lastSuccessAt: null,
        failingSince: null,
        consecutiveFailures: 0,
        budget: { limit: 100, used: 100 - remaining, remaining },
        ...extra,
      });
    const spies: Array<{ mockRestore: () => void }> = [];
    afterEach(() => {
      vi.mocked(getLeetCodeProviderStatus).mockReset().mockImplementation(realStatus!);
      for (const spy of spies.splice(0)) spy.mockRestore();
    });
    const silence = (method: 'warn' | 'error') => {
      const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
      spies.push(spy);
      return spy;
    };

    it('with the budget nearly spent, skips days still in progress but still checks past-deadline ones', async () => {
      // Day 1's deadline has passed (checked at +10 min); that is the urgent one.
      const late = await setup();
      status(10); // 10% left, under the 30% reserve
      mockGetSubmissions.mockResolvedValue({ submissions: [], limit: 20 });

      await runLeetCodeVerificationSweep(after(10 * MIN));
      expect(mockGetSubmissions).toHaveBeenCalled();
      expect((await day1(late.commitmentId))?.lastVerification).toBeDefined();

      // A commitment whose day is still running (noon on day 1) is deferred to keep budget for users.
      mockGetSubmissions.mockClear();
      const running = await setup();
      silence('warn');
      await runLeetCodeVerificationSweep(day1Noon);
      expect(
        await DailyProgress.findOne({ commitmentId: running.commitmentId, dayNumber: 1 })
      ).toMatchObject({
        lastVerification: undefined,
      });
    });

    it('with plenty of budget, checks days that are still in progress too', async () => {
      const running = await setup();
      status(100);
      mockGetSubmissions.mockResolvedValue({ submissions: [], limit: 20 });

      await runLeetCodeVerificationSweep(day1Noon);

      expect((await day1(running.commitmentId))?.lastVerification?.checkedAt).toBeDefined();
    });

    it('raises an alert once the provider has been failing for 15 minutes, and not before', async () => {
      await setup();
      const errors = silence('error');
      const failingSince = new Date(after(0).getTime());
      mockGetSubmissions.mockRejectedValue(new LeetCodeProviderError('down'));

      status(100, { state: 'down', failingSince, consecutiveFailures: 4 });
      await runLeetCodeVerificationSweep(after(10 * MIN));
      expect(errors.mock.calls.some((c) => String(c[0]).includes('leetcode_provider_down'))).toBe(
        false
      );

      await runLeetCodeVerificationSweep(after(20 * MIN));
      expect(errors.mock.calls.some((c) => String(c[0]).includes('leetcode_provider_down'))).toBe(
        true
      );
    });
  });
});

describe('completion integrity', () => {
  const app = createApp();
  const IST = '+05:30';
  const now = new Date(`2031-04-10T12:00:00${IST}`);

  it('only a manual tick can be un-ticked; verified completions stay, and a pending deposit locks the account', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Integ',
        email: `integ-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    const userId: string = reg.body.data.user.id;
    const cookie = extractAuthCookie(reg);

    const problems = await Problem.insertMany(
      ['x', 'y'].map((k, i) => ({
        title: `Integ ${k}`,
        slug: `integ-${k}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://leetcode.com/problems/integ-${k}/`,
        source: 'LeetCode',
        order: 2000 + i,
      }))
    );
    const plan = await Plan.create({
      name: 'Integ',
      slug: 'integ-plan',
      description: 'x',
      problemIds: problems.map((p) => p._id),
      order: 2000,
    });
    await User.updateOne(
      { _id: userId },
      { $set: { leetcodeUsername: 'integ', leetcodeVerifiedAt: new Date() } }
    );
    const created = await CommitmentService.create(userId, {
      planId: plan._id.toString(),
      dailyTarget: 2,
      depositAmount: 500,
    });

    // A deposit order in flight locks the account before the commitment is even active.
    await CommitmentTransaction.create({
      userId,
      commitmentId: created.id,
      type: 'DEPOSIT',
      amount: 500,
      status: 'PENDING',
      reference: 'order',
    });
    const locked = await request(app).delete('/api/integrations/leetcode').set({ Cookie: cookie });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('LEETCODE_LOCKED_BY_COMMITMENT');
    await CommitmentTransaction.deleteMany({ commitmentId: created.id });

    await CommitmentService.activateForDev(userId, created.id, now);
    const progress = await DailyProgress.findOne({ commitmentId: created.id, dayNumber: 1 });
    // One LeetCode-verified completion; then try to un-tick it.
    await DailyProgressService.recordLeetCodeCompletion(
      progress!._id,
      problems[0]._id,
      { title: 'x', titleSlug: 'integ-x', timestamp: now.getTime(), verifiedAt: now },
      now
    );
    await User.updateOne(
      { _id: userId },
      { $unset: { leetcodeUsername: 1, leetcodeVerifiedAt: 1 } }
    );
    await DailyProgressService.setProblemCompletion(
      userId,
      created.id,
      { problemId: problems[0]._id.toString(), completed: false },
      now
    );
    expect((await DailyProgress.findById(progress!._id))?.completedProblems).toBe(1);

    // A manual tick (no verified account, so allowed) can still be taken back.
    await DailyProgressService.setProblemCompletion(
      userId,
      created.id,
      { problemId: problems[1]._id.toString(), completed: true },
      now
    );
    await DailyProgressService.setProblemCompletion(
      userId,
      created.id,
      { problemId: problems[1]._id.toString(), completed: false },
      now
    );
    expect((await DailyProgress.findById(progress!._id))?.completedProblems).toBe(1);
  });
});

describe('one LeetCode account per user', () => {
  const app = createApp();
  const ask = async (label: string) => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: label,
        email: `${label}-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    return { id: res.body.data.user.id as string, cookie: extractAuthCookie(res) };
  };
  const connect = async (cookie: string, username: string) => {
    const c = await request(app)
      .post('/api/integrations/leetcode/challenge')
      .set({ Cookie: cookie })
      .send({ username });
    mockGetProfile.mockResolvedValue({ username, about: c.body.data.token });
    return request(app)
      .post('/api/integrations/leetcode/verify')
      .set({ Cookie: cookie })
      .send({ username });
  };

  beforeAll(() => User.init());

  it('refuses an account another user already verified, without burning the challenge', async () => {
    const first = await ask('uniq-a');
    const second = await ask('uniq-b');
    expect((await connect(first.cookie, 'SharedAcct')).status).toBe(200);

    // Case differences don't dodge it.
    const res = await connect(second.cookie, 'sharedacct');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LEETCODE_ACCOUNT_IN_USE');
    expect((await User.findById(second.id))?.leetcodeVerifiedAt).toBeUndefined();
    expect((await LeetCodeChallenge.findOne({ userId: second.id }))?.consumedAt).toBeNull();
  });

  it('frees the account when its owner disconnects, and lets the same user re-verify it', async () => {
    const first = await ask('free-a');
    const second = await ask('free-b');
    expect((await connect(first.cookie, 'FreedAcct')).status).toBe(200);
    expect((await connect(first.cookie, 'FreedAcct')).status).toBe(200); // same user again

    await request(app).delete('/api/integrations/leetcode').set({ Cookie: first.cookie });
    expect((await connect(second.cookie, 'freedacct')).status).toBe(200);
  });
});
