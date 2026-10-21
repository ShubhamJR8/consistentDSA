import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { Commitment } from '../models/commitment.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { CommitmentService } from '../services/commitment.service.js';
import { CommitmentRules } from '../services/commitmentRules.service.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import { addDays, dayKeyFor } from '../utils/localDate.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const TEST_DB = 'commit_dsa_test_commitments';

const buildTestUri = (baseUri: string): string => {
  const match = baseUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
  return match
    ? `${match[1]}/${TEST_DB}${match[2] ?? ''}`
    : `${baseUri.replace(/\/$/, '')}/${TEST_DB}`;
};

interface TestUser {
  id: string;
  cookie: string;
}

describe('Commitments, plans and daily progress', () => {
  const app = createApp();
  let bigPlanId: string;
  let smallPlanId: string;
  let emptyPlanId: string;
  let problemIds: string[];

  const register = async (label: string, timezone: string): Promise<TestUser> => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: `Test ${label}`,
        email: `commitment-test-${label}-${Date.now()}@example.com`,
        password: 'password123',
        timezone,
      });
    expect(res.status).toBe(201);
    return { id: res.body.data.user.id, cookie: extractAuthCookie(res) };
  };

  const auth = (user: TestUser) => ({ Cookie: user.cookie });

  // durationDays is never sent by the client anymore — it's derived server-side from the plan's
  // problem count and dailyTarget. bigPlanId has 21 problems, so ceil(21 / 3) = 7 days, matching
  // every date-anchored assertion below that still expects a 7-day schedule.
  const validBody = () => ({
    planId: bigPlanId,
    dailyTarget: 3,
    depositAmount: 1000,
  });

  beforeAll(async () => {
    await mongoose.connect(buildTestUri(env.MONGODB_URI));
    // Only ever wipe the dedicated test database.
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([Commitment.init(), DailyProgress.init(), Plan.init(), Problem.init()]);

    const problems = await Problem.insertMany(
      Array.from({ length: 21 }, (_, i) => ({
        title: `Problem ${i + 1}`,
        slug: `ct-problem-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/problems/${i + 1}`,
        source: 'Test',
        order: i + 1,
      }))
    );
    problemIds = problems.map((p) => p._id.toString());

    const [big, small, empty] = await Plan.create([
      {
        name: 'Test Big',
        slug: 'ct-big',
        description: 'Big plan',
        problemIds: problems.map((p) => p._id),
        order: 0,
      },
      {
        name: 'Test Small',
        slug: 'ct-small',
        description: 'Small plan',
        problemIds: problems.slice(0, 5).map((p) => p._id),
        order: 1,
      },
      {
        name: 'Test Empty',
        slug: 'ct-empty',
        description: 'Empty plan',
        problemIds: [],
        order: 2,
      },
    ]);
    bigPlanId = big._id.toString();
    smallPlanId = small._id.toString();
    emptyPlanId = empty._id.toString();
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  describe('HTTP API', () => {
    let alice: TestUser;
    let bob: TestUser;
    let commitmentId: string;

    beforeAll(async () => {
      alice = await register('alice', 'America/New_York');
      bob = await register('bob', 'Asia/Kolkata');
    });

    it('requires authentication on every new route', async () => {
      for (const path of ['/api/commitments', '/api/commitments/options']) {
        const res = await request(app).get(path);
        expect(res.status).toBe(401);
      }
    });

    it('serves the catalog (plans/problems) without authentication', async () => {
      for (const path of ['/api/plans', '/api/problems']) {
        const res = await request(app).get(path);
        expect(res.status).toBe(200);
      }
    });

    it('serves the creation options and default rules from the server', async () => {
      const res = await request(app).get('/api/commitments/options').set(auth(alice));
      expect(res.status).toBe(200);
      expect(res.body.data.dailyTargets).toEqual([1, 2, 3, 5]);
      expect(res.body.data.depositAmounts).toEqual([500, 1000, 2000, 5000]);
      expect(res.body.data.recommendedDailyTarget).toBe(2);
      expect(res.body.data.rules).toEqual(CommitmentRules.defaultRules());
    });

    it('lists plans with problem counts and returns ordered plan detail', async () => {
      const list = await request(app).get('/api/plans').set(auth(alice));
      expect(list.status).toBe(200);
      const big = list.body.data.find((p: { slug: string }) => p.slug === 'ct-big');
      expect(big.problemCount).toBe(21);

      const detail = await request(app).get(`/api/plans/${bigPlanId}`).set(auth(alice));
      expect(detail.status).toBe(200);
      expect(detail.body.data.problems).toHaveLength(21);
      expect(detail.body.data.problems[0].title).toBe('Problem 1');
      expect(detail.body.data.problems[20].title).toBe('Problem 21');
    });

    it('filters problems and ignores non-string query filters', async () => {
      const all = await request(app).get('/api/problems').set(auth(alice));
      expect(all.body.data).toHaveLength(21);

      const hard = await request(app).get('/api/problems?difficulty=Hard').set(auth(alice));
      expect(hard.body.data).toHaveLength(0);

      const injected = await request(app).get('/api/problems?topic[$ne]=x').set(auth(alice));
      expect(injected.status).toBe(200);
      expect(injected.body.data).toHaveLength(21);

      const one = await request(app).get(`/api/problems/${problemIds[0]}`).set(auth(alice));
      expect(one.body.data.title).toBe('Problem 1');
      const missing = await request(app).get('/api/problems/not-an-id').set(auth(alice));
      expect(missing.status).toBe(404);
    });

    it('rejects values outside the server allow-lists', async () => {
      for (const patch of [{ depositAmount: 1 }, { dailyTarget: 4 }, { planId: 'nope' }]) {
        const res = await request(app)
          .post('/api/commitments')
          .set(auth(alice))
          .send({ ...validBody(), ...patch });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects committing to a plan with no problems', async () => {
      const res = await request(app)
        .post('/api/commitments')
        .set(auth(alice))
        .send({ ...validBody(), planId: emptyPlanId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PLAN_EMPTY');
    });

    it('computes duration dynamically from the plan size and daily target, uneven splits included', async () => {
      // Any plan works now — no "too small" rejection — since duration is always derived, never
      // picked. smallPlanId has 5 problems; at 3/day that's ceil(5 / 3) = 2 days, with the last
      // day getting only the 2 problems left over instead of the full daily target.
      const erin = await register('erin', 'Asia/Kolkata');
      const created = await request(app)
        .post('/api/commitments')
        .set(auth(erin))
        .send({ planId: smallPlanId, dailyTarget: 3, depositAmount: 1000 });
      expect(created.status).toBe(201);
      expect(created.body.data.durationDays).toBe(2);
      expect(created.body.data.totalProblems).toBe(5);

      const activated = await request(app)
        .post(`/api/commitments/${created.body.data.id}/dev-activate`)
        .set(auth(erin));
      expect(activated.status).toBe(200);

      const progress = await request(app)
        .get(`/api/commitments/${created.body.data.id}/progress`)
        .set(auth(erin));
      expect(
        progress.body.data.days.map((d: { requiredProblems: number }) => d.requiredProblems)
      ).toEqual([3, 2]);
    });

    it('creates a pending commitment for the token user and ignores a spoofed userId', async () => {
      const res = await request(app)
        .post('/api/commitments')
        .set(auth(alice))
        .send({ ...validBody(), userId: bob.id });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING_PAYMENT');
      expect(res.body.data.timezone).toBe('America/New_York');
      expect(res.body.data.durationDays).toBe(7);
      expect(res.body.data.totalProblems).toBe(21);
      expect(res.body.data.rules).toEqual(CommitmentRules.defaultRules());
      expect(res.body.data.userId).toBeUndefined();
      commitmentId = res.body.data.id;

      const stored = await Commitment.findById(commitmentId);
      expect(stored?.userId.toString()).toBe(alice.id);
    });

    it('allows only one open commitment per user', async () => {
      const res = await request(app).post('/api/commitments').set(auth(alice)).send(validBody());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OPEN_COMMITMENT_EXISTS');
    });

    it('enforces the one-open-commitment rule under concurrent requests', async () => {
      const carol = await register('carol', 'UTC');
      const results = await Promise.all([
        request(app).post('/api/commitments').set(auth(carol)).send(validBody()),
        request(app).post('/api/commitments').set(auth(carol)).send(validBody()),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await Commitment.countDocuments({ userId: carol.id })).toBe(1);
    });

    it("never exposes another user's commitment", async () => {
      for (const path of [
        `/${commitmentId}`,
        `/${commitmentId}/today`,
        `/${commitmentId}/progress`,
      ]) {
        const res = await request(app).get(`/api/commitments${path}`).set(auth(bob));
        expect(res.status).toBe(404);
      }
      const write = await request(app)
        .post(`/api/commitments/${commitmentId}/daily-progress`)
        .set(auth(bob))
        .send({ problemId: problemIds[0], completed: true });
      expect(write.status).toBe(404);

      const malformed = await request(app).get('/api/commitments/abc').set(auth(alice));
      expect(malformed.status).toBe(404);
    });

    it('does not serve today or progress before payment', async () => {
      const today = await request(app)
        .get(`/api/commitments/${commitmentId}/today`)
        .set(auth(alice));
      expect(today.status).toBe(409);
      expect(today.body.error.code).toBe('COMMITMENT_NOT_ACTIVE');
      const progress = await request(app)
        .get(`/api/commitments/${commitmentId}/progress`)
        .set(auth(alice));
      expect(progress.status).toBe(409);
    });

    it('activates for development with day 1 starting today', async () => {
      const before = dayKeyFor(new Date(), 'America/New_York');
      const res = await request(app)
        .post(`/api/commitments/${commitmentId}/dev-activate`)
        .set(auth(alice));
      const after = dayKeyFor(new Date(), 'America/New_York');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACTIVE');
      expect([before, after]).toContain(res.body.data.startDate);
      expect(res.body.data.endDate).toBe(addDays(res.body.data.startDate, 6));

      const again = await request(app)
        .post(`/api/commitments/${commitmentId}/dev-activate`)
        .set(auth(alice));
      expect(again.status).toBe(409);
    });

    it('reports IN_PROGRESS with day 1 already live, immediately after activation', async () => {
      const today = await request(app)
        .get(`/api/commitments/${commitmentId}/today`)
        .set(auth(alice));
      expect(today.status).toBe(200);
      expect(today.body.data.phase).toBe('IN_PROGRESS');
      expect(today.body.data.today.dayNumber).toBe(1);

      const progress = await request(app)
        .get(`/api/commitments/${commitmentId}/progress`)
        .set(auth(alice));
      expect(progress.body.data.days).toHaveLength(7);
      expect(progress.body.data.days[0].isToday).toBe(true);
      expect(
        progress.body.data.days
          .slice(1)
          .every(
            (d: { status: string; isUpcoming: boolean }) => d.status === 'PENDING' && d.isUpcoming
          )
      ).toBe(true);

      const list = await request(app).get('/api/commitments').set(auth(alice));
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(commitmentId);
    });
  });

  describe('Day logic with a controlled clock', () => {
    const IST = '+05:30';
    let userId: string;
    let commitmentId: string;

    const at = (iso: string) => new Date(iso);
    const day1 = at(`2030-01-10T12:00:00${IST}`);

    beforeAll(async () => {
      const dana = await register('dana', 'Asia/Kolkata');
      userId = dana.id;
      const created = await CommitmentService.create(userId, validBody());
      commitmentId = created.id;
      const activated = await CommitmentService.activateForDev(
        userId,
        commitmentId,
        at(`2030-01-10T10:00:00${IST}`)
      );
      expect(activated.startDate).toBe('2030-01-10');
      expect(activated.endDate).toBe('2030-01-16');
    });

    it('is in progress immediately, the moment activation lands', async () => {
      const res = await DailyProgressService.getToday(
        userId,
        commitmentId,
        at(`2030-01-10T10:00:01${IST}`)
      );
      expect(res.phase).toBe('IN_PROGRESS');
      expect(res.today?.dayNumber).toBe(1);
    });

    it('assigns each day its own slice of the plan and sets the local-midnight deadline', async () => {
      const res = await DailyProgressService.getToday(userId, commitmentId, day1);
      expect(res.phase).toBe('IN_PROGRESS');
      expect(res.today?.dayNumber).toBe(1);
      expect(res.today?.problems.map((p) => p.title)).toEqual([
        'Problem 1',
        'Problem 2',
        'Problem 3',
      ]);
      expect(res.today?.deadlineAt.toISOString()).toBe('2030-01-10T18:29:59.999Z');
    });

    it('refuses problems that are not assigned to today', async () => {
      await expect(
        DailyProgressService.setProblemCompletion(
          userId,
          commitmentId,
          { problemId: problemIds[3], completed: true },
          day1
        )
      ).rejects.toMatchObject({ code: 'PROBLEM_NOT_ASSIGNED' });
    });

    it('will not complete a day until every assigned problem is checked', async () => {
      await DailyProgressService.setProblemCompletion(
        userId,
        commitmentId,
        { problemId: problemIds[0], completed: true },
        day1
      );
      await expect(
        DailyProgressService.completeDay(userId, commitmentId, day1)
      ).rejects.toMatchObject({
        code: 'DAY_INCOMPLETE',
      });
    });

    it('records concurrent and repeated checks without loss or duplication', async () => {
      await Promise.all(
        problemIds
          .slice(0, 3)
          .map((problemId) =>
            DailyProgressService.setProblemCompletion(
              userId,
              commitmentId,
              { problemId, completed: true },
              day1
            )
          )
      );
      await DailyProgressService.setProblemCompletion(
        userId,
        commitmentId,
        { problemId: problemIds[0], completed: true },
        day1
      );
      let res = await DailyProgressService.getToday(userId, commitmentId, day1);
      expect(res.today?.completedProblems).toBe(3);
      expect(res.today?.problems.every((p) => p.completed && p.completedAt)).toBe(true);

      res = await DailyProgressService.setProblemCompletion(
        userId,
        commitmentId,
        { problemId: problemIds[0], completed: false },
        day1
      );
      expect(res.today?.completedProblems).toBe(2);
      await expect(
        DailyProgressService.completeDay(userId, commitmentId, day1)
      ).rejects.toMatchObject({
        code: 'DAY_INCOMPLETE',
      });
      await DailyProgressService.setProblemCompletion(
        userId,
        commitmentId,
        { problemId: problemIds[0], completed: true },
        day1
      );
    });

    it('completes the day once, idempotently, and then locks it', async () => {
      const done = await DailyProgressService.completeDay(userId, commitmentId, day1);
      expect(done.today?.status).toBe('COMPLETED');
      expect(done.commitment.completedDays).toBe(1);

      const again = await DailyProgressService.completeDay(userId, commitmentId, day1);
      expect(again.today?.status).toBe('COMPLETED');

      await expect(
        DailyProgressService.setProblemCompletion(
          userId,
          commitmentId,
          { problemId: problemIds[0], completed: false },
          day1
        )
      ).rejects.toMatchObject({ code: 'DAY_ALREADY_COMPLETED' });
    });

    it('moves to the next day exactly at local midnight', async () => {
      const lastSecond = await DailyProgressService.getToday(
        userId,
        commitmentId,
        at('2030-01-10T18:29:59Z')
      );
      expect(lastSecond.today?.dayNumber).toBe(1);
      const midnight = await DailyProgressService.getToday(
        userId,
        commitmentId,
        at('2030-01-10T18:30:00Z')
      );
      expect(midnight.today?.dayNumber).toBe(2);
      expect(midnight.today?.status).toBe('PENDING');
    });

    it('marks unfinished past days as missed and never allows backfilling', async () => {
      const day4 = at(`2030-01-13T09:00:00${IST}`);
      const progress = await DailyProgressService.getProgress(userId, commitmentId, day4);
      expect(progress.days.map((d) => d.status)).toEqual([
        'COMPLETED',
        'MISSED',
        'MISSED',
        'PENDING',
        'PENDING',
        'PENDING',
        'PENDING',
      ]);
      expect(progress.days[3].isToday).toBe(true);
      expect(progress.days[4].isUpcoming).toBe(true);
      expect(progress.commitment.completedDays).toBe(1);
      expect(progress.commitment.missedDays).toBe(2);

      await expect(
        DailyProgressService.setProblemCompletion(
          userId,
          commitmentId,
          { problemId: problemIds[3], completed: true },
          day4
        )
      ).rejects.toMatchObject({ code: 'PROBLEM_NOT_ASSIGNED' });
    });

    it('reports the schedule as ended once the last day has passed', async () => {
      const after = at(`2030-01-18T09:00:00${IST}`);
      const res = await DailyProgressService.getToday(userId, commitmentId, after);
      expect(res.phase).toBe('ENDED');
      expect(res.today).toBeNull();

      const progress = await DailyProgressService.getProgress(userId, commitmentId, after);
      expect(progress.days.map((d) => d.status)).toEqual([
        'COMPLETED',
        'MISSED',
        'MISSED',
        'MISSED',
        'MISSED',
        'MISSED',
        'MISSED',
      ]);
      expect(progress.commitment.missedDays).toBe(6);
      // The last day is no longer PENDING once the schedule ends, so the commitment
      // auto-finalizes: any missed day means FAILED, never leaving it dangling as ACTIVE.
      expect(progress.commitment.status).toBe('FAILED');
      expect(progress.commitment.currentStreak).toBe(0);
      expect(progress.commitment.longestStreak).toBe(1);
      expect(progress.commitment.currentForfeitedAmount).toBe(600);
      expect(progress.commitment.currentProtectedAmount).toBe(400);

      // Once finalized the commitment is no longer ACTIVE at all, so writes are refused before
      // the day-in-range check ever runs.
      await expect(
        DailyProgressService.setProblemCompletion(
          userId,
          commitmentId,
          { problemId: problemIds[0], completed: true },
          after
        )
      ).rejects.toMatchObject({ code: 'COMMITMENT_NOT_ACTIVE' });
    });

    it('records one FORFEITURE ledger row per missed day, in order', async () => {
      const after = at(`2030-01-18T09:00:00${IST}`);
      const ledger = await CommitmentService.getLedger(userId, commitmentId, after);

      expect(ledger.commitment.status).toBe('FAILED');
      expect(ledger.transactions).toHaveLength(6);
      expect(ledger.transactions.every((t) => t.type === 'FORFEITURE')).toBe(true);
      expect(ledger.transactions.every((t) => t.status === 'SUCCESS')).toBe(true);
      expect(ledger.transactions.every((t) => t.amount === 100)).toBe(true);
      expect(ledger.transactions.map((t) => new Date(t.createdAt).getTime())).toEqual(
        [...ledger.transactions].map((t) => new Date(t.createdAt).getTime()).sort((a, b) => a - b)
      );
    });
  });
});
