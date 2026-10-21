import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../integrations/leetcode/leetcode.client.js', () => ({
  leetCodeClient: { getRecentSubmissions: vi.fn() },
}));

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { Commitment } from '../models/commitment.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { CommitmentService } from '../services/commitment.service.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import { LeetCodeVerificationService } from '../services/leetcodeVerification.service.js';
import { leetCodeClient } from '../integrations/leetcode/leetcode.client.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const mockGetRecentSubmissions = vi.mocked(leetCodeClient.getRecentSubmissions);

const TEST_DB = 'commit_dsa_test_leetcode';

const buildTestUri = (baseUri: string): string => {
  const match = baseUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
  return match
    ? `${match[1]}/${TEST_DB}${match[2] ?? ''}`
    : `${baseUri.replace(/\/$/, '')}/${TEST_DB}`;
};

describe('LeetCode-based completion verification', () => {
  const app = createApp();
  const IST = '+05:30';
  // Day 1 is 2031-02-10 in Asia/Kolkata — the same local day activation lands on, since a
  // commitment now starts immediately rather than the next calendar day. Well inside this
  // window is "accepted", the day before is "old submission".
  const day1 = new Date(`2031-02-10T12:00:00${IST}`);
  const day1Start = new Date(`2031-02-10T00:00:00${IST}`).getTime();

  let twoSumId: string;
  let reverseStringId: string;
  let validParenthesesId: string;
  let userId: string;
  let cookie: string;
  let commitmentId: string;
  /** A second, otherwise-unused user who never connects a LeetCode username. */
  let unconnectedUserId: string;

  beforeAll(async () => {
    await mongoose.connect(buildTestUri(env.MONGODB_URI));
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([Commitment.init(), DailyProgress.init(), Plan.init(), Problem.init()]);

    const problems = await Problem.insertMany([
      {
        title: 'Two Sum',
        slug: 'two-sum',
        difficulty: 'Easy',
        topic: 'Test',
        url: 'https://leetcode.com/problems/two-sum/',
        source: 'LeetCode',
        order: 1,
      },
      {
        title: 'Reverse String',
        slug: 'reverse-string',
        difficulty: 'Easy',
        topic: 'Test',
        url: 'https://leetcode.com/problems/reverse-string/',
        source: 'LeetCode',
        order: 2,
      },
      {
        title: 'Valid Parentheses',
        slug: 'valid-parentheses',
        difficulty: 'Easy',
        topic: 'Test',
        url: 'https://leetcode.com/problems/valid-parentheses/',
        source: 'LeetCode',
        order: 3,
      },
    ]);
    [twoSumId, reverseStringId, validParenthesesId] = problems.map((p) => p._id.toString());

    // 7 days at 3/day = 21 slots; only the first 3 (day 1) matter for these tests.
    const filler = await Problem.insertMany(
      Array.from({ length: 18 }, (_, i) => ({
        title: `Filler ${i + 1}`,
        slug: `lc-filler-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/filler-${i + 1}`,
        source: 'Test',
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

    const register = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'LeetCode Tester',
        email: `leetcode-test-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(register.status).toBe(201);
    userId = register.body.data.user.id;
    cookie = extractAuthCookie(register);

    // 21 problems / 3 per day = exactly 7 days — durationDays is derived, not passed in.
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

    const secondRegister = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'No LeetCode Tester',
        email: `leetcode-test-unconnected-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(secondRegister.status).toBe(201);
    unconnectedUserId = secondRegister.body.data.user.id;
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(() => {
    mockGetRecentSubmissions.mockReset();
  });

  describe('PUT /api/users/me/leetcode', () => {
    const auth = () => ({ Cookie: cookie });

    it('connects a username that exists on LeetCode, even with zero submissions', async () => {
      mockGetRecentSubmissions.mockResolvedValueOnce([]);
      const res = await request(app)
        .put('/api/users/me/leetcode')
        .set(auth())
        .send({ username: 'shubham123' });

      expect(res.status).toBe(200);
      expect(res.body.data.leetcodeUsername).toBe('shubham123');
    });

    it('rejects a username LeetCode has no record of', async () => {
      mockGetRecentSubmissions.mockResolvedValueOnce(null);
      const res = await request(app)
        .put('/api/users/me/leetcode')
        .set(auth())
        .send({ username: 'definitely-not-a-real-user' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEETCODE_USERNAME_NOT_FOUND');
    });

    it('requires authentication', async () => {
      const res = await request(app).put('/api/users/me/leetcode').send({ username: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/commitments/:id/verify-today', () => {
    it('requires authentication', async () => {
      const res = await request(app).post(`/api/commitments/${commitmentId}/verify-today`);
      expect(res.status).toBe(401);
    });
  });

  describe('LeetCodeVerificationService.verifyToday', () => {
    it('has no LeetCode username connected yet — refuses with a clear error', async () => {
      // The username check happens before the commitment is even touched, so any commitment id
      // is fine here — this user simply never connected a LeetCode account.
      await expect(
        LeetCodeVerificationService.verifyToday(unconnectedUserId, commitmentId, day1)
      ).rejects.toMatchObject({ code: 'LEETCODE_NOT_CONNECTED' });
      expect(mockGetRecentSubmissions).not.toHaveBeenCalled();
    });

    it('connects the username so the rest of the suite can verify against it', async () => {
      mockGetRecentSubmissions.mockResolvedValueOnce([]);
      const res = await request(app)
        .put('/api/users/me/leetcode')
        .set({ Cookie: cookie })
        .send({ username: 'shubham123' });
      expect(res.status).toBe(200);
    });

    it(
      'verifies the matching Accepted submission, ignores an old one, and ignores a ' +
        'same-slug submission that was not Accepted — in one pass covering every assigned problem',
      async () => {
        // verifyToday calls getRecentSubmissions once per unsolved problem, so this needs to hold
        // across every call in the test, not just the first.
        mockGetRecentSubmissions.mockResolvedValue([
          // Case 1 — correct problem, Accepted, inside today's window: VERIFIED.
          {
            id: 'sub-1',
            title: 'Two Sum',
            titleSlug: 'two-sum',
            statusDisplay: 'Accepted',
            timestamp: day1Start + 60 * 60 * 1000,
          },
          // Case 5 — a second Accepted submission for the same problem: still only one completion.
          {
            id: 'sub-1b',
            title: 'Two Sum',
            titleSlug: 'two-sum',
            statusDisplay: 'Accepted',
            timestamp: day1Start + 90 * 60 * 1000,
          },
          // Case 4 — correct problem, Accepted, but from the day before: stays pending.
          {
            id: 'sub-2',
            title: 'Reverse String',
            titleSlug: 'reverse-string',
            statusDisplay: 'Accepted',
            timestamp: day1Start - 60 * 60 * 1000,
          },
          // Case 3 — correct problem, inside the window, but not Accepted: stays pending.
          {
            id: 'sub-3',
            title: 'Valid Parentheses',
            titleSlug: 'valid-parentheses',
            statusDisplay: 'Wrong Answer',
            timestamp: day1Start + 30 * 60 * 1000,
          },
        ]);

        const result = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);

        expect(result.providerAvailable).toBe(true);
        expect(result.verifiedProblemIds).toEqual([twoSumId]);
        expect(result.stillPendingProblemIds.sort()).toEqual(
          [reverseStringId, validParenthesesId].sort()
        );
        expect(mockGetRecentSubmissions).toHaveBeenCalledTimes(3); // once per unsolved problem

        const progress = await DailyProgress.findOne({ commitmentId, dayNumber: 1 });
        const completions = progress?.problemCompletions ?? [];
        expect(completions).toHaveLength(1); // only one entry despite two matching submissions
        expect(completions[0]?.method).toBe('LEETCODE');
        expect(completions[0]?.leetcodeEvidence?.titleSlug).toBe('two-sum');
      }
    );

    it('is idempotent — calling it again does not re-verify or duplicate the completion', async () => {
      mockGetRecentSubmissions.mockResolvedValue([
        {
          id: 'sub-1',
          title: 'Two Sum',
          titleSlug: 'two-sum',
          statusDisplay: 'Accepted',
          timestamp: day1Start + 60 * 60 * 1000,
        },
      ]);

      const result = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);
      expect(result.verifiedProblemIds).toEqual([]); // two-sum is already checked off

      const progress = await DailyProgress.findOne({ commitmentId, dayNumber: 1 });
      expect(progress?.problemCompletions).toHaveLength(1);
    });

    it('a provider failure leaves everything pending — never marks anything missed or failed', async () => {
      mockGetRecentSubmissions.mockRejectedValue(new Error('ECONNRESET'));

      const result = await LeetCodeVerificationService.verifyToday(userId, commitmentId, day1);

      expect(result.providerAvailable).toBe(false);
      expect(result.verifiedProblemIds).toEqual([]);
      expect(result.stillPendingProblemIds.sort()).toEqual(
        [reverseStringId, validParenthesesId].sort()
      );

      const progress = await DailyProgress.findOne({ commitmentId, dayNumber: 1 });
      expect(progress?.status).toBe('PENDING');
    });

    it('finishing the day off manually still only counts completedDays once', async () => {
      await DailyProgressService.setProblemCompletion(
        userId,
        commitmentId,
        { problemId: reverseStringId, completed: true },
        day1
      );
      await DailyProgressService.setProblemCompletion(
        userId,
        commitmentId,
        { problemId: validParenthesesId, completed: true },
        day1
      );
      const done = await DailyProgressService.completeDay(userId, commitmentId, day1);
      expect(done.today?.status).toBe('COMPLETED');
      expect(done.commitment.completedDays).toBe(1);
    });
  });
});
