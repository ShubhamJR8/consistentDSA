import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

// Mocked before any local imports run, so SubmissionService gets the mocked runBatch.
vi.mock('../services/judge0.service.js', () => ({ runBatch: vi.fn() }));

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { Commitment } from '../models/commitment.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { Submission } from '../models/submission.model.js';
import { CommitmentService } from '../services/commitment.service.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import { runBatch } from '../services/judge0.service.js';
import { SubmissionService } from '../services/submission.service.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const mockRunBatch = vi.mocked(runBatch);

const TEST_DB = 'commit_dsa_test_submissions';

const buildTestUri = (baseUri: string): string => {
  const match = baseUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
  return match
    ? `${match[1]}/${TEST_DB}${match[2] ?? ''}`
    : `${baseUri.replace(/\/$/, '')}/${TEST_DB}`;
};

// Always ACCEPTED regardless of what code was sent — used for the "correct solution" cases.
const allPass = () =>
  mockRunBatch.mockImplementationOnce(async (input) =>
    input.tests.map((t) => ({
      passed: true,
      status: 'ACCEPTED' as const,
      stdout: t.expectedOutput,
      stderr: null,
      timeMs: 4,
    }))
  );

const firstFails = () =>
  mockRunBatch.mockImplementationOnce(async (input) =>
    input.tests.map((t, index) => ({
      passed: index !== 0,
      status: (index === 0 ? 'WRONG_ANSWER' : 'ACCEPTED') as const,
      stdout: index === 0 ? 'nope' : t.expectedOutput,
      stderr: null,
      timeMs: 4,
    }))
  );

describe('In-editor judge (run/submit)', () => {
  const app = createApp();
  // Route handlers always use the real clock, so HTTP-level tests below only cover things that
  // don't depend on "today" being a specific day. Day-1 behaviour needs a controlled clock, same
  // as commitment.test.ts's "Day logic" suite, so those tests call the services directly.
  const IST = '+05:30';
  // A commitment now starts on the same local day it's activated, so day 1 matches the
  // activation call below (2031-02-10), not the day after it.
  const day1 = new Date(`2031-02-10T12:00:00${IST}`);

  let judgeProblemId: string;
  let plainProblemId: string;
  let hiddenTestInput: string;
  let userId: string;
  let cookie: string;
  let commitmentId: string;

  beforeAll(async () => {
    await mongoose.connect(buildTestUri(env.MONGODB_URI));
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      Commitment.init(),
      DailyProgress.init(),
      Plan.init(),
      Problem.init(),
      Submission.init(),
    ]);

    const testCases = [
      { input: '5\n1 2 3 1 5', expectedOutput: 'true', isSample: true },
      { input: '4\n7 8 9 10', expectedOutput: 'false', isSample: true },
      { input: '1\n42', expectedOutput: 'false', isSample: false },
    ];
    hiddenTestInput = testCases[2].input;

    const judgeProblem = await Problem.create({
      title: 'Contains Duplicate (test)',
      slug: 'st-contains-duplicate',
      difficulty: 'Easy',
      topic: 'Test',
      url: 'https://example.com/contains-duplicate',
      source: 'Test',
      order: 1,
      judgeEnabled: true,
      statement: 'Print true if any value repeats.',
      constraints: ['1 <= n <= 100000'],
      examples: [{ input: '5\n1 2 3 1 5', output: 'true' }],
      starterCode: [{ language: 'javascript', code: 'console.log(false);' }],
      testCases,
    });
    judgeProblemId = judgeProblem._id.toString();

    const filler = await Problem.insertMany(
      Array.from({ length: 13 }, (_, i) => ({
        title: `Filler ${i + 1}`,
        slug: `st-filler-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/filler-${i + 1}`,
        source: 'Test',
        order: i + 2,
      }))
    );
    plainProblemId = filler[0]._id.toString();

    const plan = await Plan.create({
      name: 'Judge Test Plan',
      slug: 'st-judge-plan',
      description: 'Plan for judge tests',
      problemIds: [judgeProblem._id, ...filler.map((p) => p._id)],
      order: 0,
    });

    const register = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Judge Tester',
        email: `judge-test-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(register.status).toBe(201);
    userId = register.body.data.user.id;
    cookie = extractAuthCookie(register);

    // 14 problems (1 judge + 13 filler) / 2 per day = exactly 7 days — derived, not passed in.
    const created = await CommitmentService.create(userId, {
      planId: plan._id.toString(),
      dailyTarget: 2,
      depositAmount: 1000,
    });
    commitmentId = created.id;
    await CommitmentService.activateForDev(
      userId,
      commitmentId,
      new Date(`2031-02-10T10:00:00${IST}`)
    );

    const today = await DailyProgressService.getToday(userId, commitmentId, day1);
    expect(today.today?.problems.map((p) => p.id)).toEqual([judgeProblemId, plainProblemId]);
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  describe('HTTP: things independent of "today"', () => {
    const auth = () => ({ Cookie: cookie });

    it("exposes the judge-enabled problem's original content, but only sample tests", async () => {
      const res = await request(app).get(`/api/problems/${judgeProblemId}/judge`);
      expect(res.status).toBe(200);
      expect(res.body.data.judgeEnabled).toBe(true);
      expect(res.body.data.statement).toContain('Print true');
      expect(res.body.data.sampleTests).toHaveLength(2);
      // The hidden test's input must never leak through this endpoint.
      expect(JSON.stringify(res.body.data)).not.toContain(hiddenTestInput);
    });

    it('404s the judge-detail route for a problem that has no judge content', async () => {
      const res = await request(app).get(`/api/problems/${plainProblemId}/judge`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('JUDGE_PROBLEM_NOT_FOUND');
    });

    it('rejects an unsupported language before ever calling the judge', async () => {
      const res = await request(app)
        .post(`/api/commitments/${commitmentId}/today/problems/${judgeProblemId}/run`)
        .set(auth())
        .send({ language: 'brainfuck', code: '+++' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockRunBatch).not.toHaveBeenCalled();
    });

    it('requires authentication on the run/submit routes', async () => {
      for (const action of ['run', 'submit']) {
        const res = await request(app)
          .post(`/api/commitments/${commitmentId}/today/problems/${judgeProblemId}/${action}`)
          .send({ language: 'javascript', code: 'x' });
        expect(res.status).toBe(401);
      }
    });
  });

  describe('Service-level: day-1 behaviour with a controlled clock', () => {
    it('refuses to manually check off a judge-enabled problem', async () => {
      await expect(
        DailyProgressService.setProblemCompletion(
          userId,
          commitmentId,
          { problemId: judgeProblemId, completed: true },
          day1
        )
      ).rejects.toMatchObject({ code: 'JUDGE_REQUIRED' });
    });

    it('runs only the sample tests and persists nothing', async () => {
      allPass();
      const result = await SubmissionService.run(
        userId,
        commitmentId,
        judgeProblemId,
        { language: 'javascript', code: 'console.log(true);' },
        day1
      );

      expect(result.allPassed).toBe(true);
      expect(result.results).toHaveLength(2); // only the two sample cases
      expect(mockRunBatch).toHaveBeenCalledTimes(1);
      expect(mockRunBatch.mock.calls[0][0].tests).toHaveLength(2);
      expect(await Submission.countDocuments()).toBe(0);
    });

    it('a failing submit does not mark the problem complete and hides hidden-test details', async () => {
      firstFails();
      const result = await SubmissionService.submit(
        userId,
        commitmentId,
        judgeProblemId,
        { language: 'javascript', code: 'console.log(false);' },
        day1
      );

      expect(result.status).toBe('WRONG_ANSWER');
      expect(result.markedComplete).toBe(false);
      expect(result.totalCount).toBe(3);
      const hidden = result.results.find((r) => !r.isSample);
      expect(hidden?.expectedOutput).toBeUndefined();
      expect(hidden?.actualOutput).toBeUndefined();

      const today = await DailyProgressService.getToday(userId, commitmentId, day1);
      expect(today.today?.problems.find((p) => p.id === judgeProblemId)?.completed).toBe(false);
    });

    it('an accepted submit auto-completes the problem via JUDGE0, not a manual tick', async () => {
      allPass();
      const result = await SubmissionService.submit(
        userId,
        commitmentId,
        judgeProblemId,
        { language: 'javascript', code: 'console.log(true);' },
        day1
      );

      expect(result.status).toBe('ACCEPTED');
      expect(result.markedComplete).toBe(true);

      const stored = await Submission.findById(result.id);
      expect(stored?.status).toBe('ACCEPTED');
      expect(stored?.results).toHaveLength(3); // full set, including hidden, kept for audit

      const progress = await DailyProgress.findOne({ commitmentId, dayNumber: 1 });
      const completion = progress?.problemCompletions.find(
        (c) => c.problemId.toString() === judgeProblemId
      );
      expect(completion?.method).toBe('JUDGE0');
      expect(completion?.submissionId?.toString()).toBe(result.id);
    });

    it('still requires the plain problem to be checked before the day can complete', async () => {
      await expect(
        DailyProgressService.completeDay(userId, commitmentId, day1)
      ).rejects.toMatchObject({ code: 'DAY_INCOMPLETE' });

      await DailyProgressService.setProblemCompletion(
        userId,
        commitmentId,
        { problemId: plainProblemId, completed: true },
        day1
      );

      const done = await DailyProgressService.completeDay(userId, commitmentId, day1);
      expect(done.today?.status).toBe('COMPLETED');
    });

    it("never runs code against another user's commitment", async () => {
      const other = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Other Tester',
          email: `judge-other-${Date.now()}@example.com`,
          password: 'password123',
          timezone: 'Asia/Kolkata',
        });
      await expect(
        SubmissionService.run(
          other.body.data.user.id,
          commitmentId,
          judgeProblemId,
          { language: 'javascript', code: 'console.log(true);' },
          day1
        )
      ).rejects.toMatchObject({ code: 'COMMITMENT_NOT_FOUND' });
    });
  });
});
