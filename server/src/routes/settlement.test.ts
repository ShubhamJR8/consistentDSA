import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../integrations/razorpay/razorpay.client.js', () => ({
  isRazorpayConfigured: vi.fn(),
  razorpayClient: {
    createOrder: vi.fn(),
    verifyCheckoutSignature: vi.fn(),
    refund: vi.fn(),
  },
}));

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { isRazorpayConfigured, razorpayClient } from '../integrations/razorpay/razorpay.client.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import { PaymentService } from '../services/payment.service.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const mockIsConfigured = vi.mocked(isRazorpayConfigured);
const mockCreateOrder = vi.mocked(razorpayClient.createOrder);
const mockVerifySignature = vi.mocked(razorpayClient.verifyCheckoutSignature);

const TEST_DB = 'commit_dsa_test_settlement';

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

describe('Commitment settlement — refund queueing', () => {
  const app = createApp();
  let planId: string;
  let problemIds: string[];
  const IST = '+05:30';
  const at = (iso: string) => new Date(iso);

  const register = async (label: string): Promise<TestUser> => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: `Settlement ${label}`,
        email: `settlement-test-${label}-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(res.status).toBe(201);
    // Deposits require a verified email (see payment.service.ts) — irrelevant to what this
    // suite is testing, so mark it verified up front.
    await User.updateOne({ _id: res.body.data.user.id }, { $set: { emailVerified: true } });
    return { id: res.body.data.user.id, cookie: extractAuthCookie(res) };
  };
  const auth = (user: TestUser) => ({ Cookie: user.cookie });

  /**
   * Creates, pays for (mocked), and activates a 3-day / 1-problem-per-day / ₹1000 commitment,
   * landing on a controlled date — calls PaymentService directly (rather than over HTTP) since
   * the HTTP endpoint always uses the real clock, and this suite needs a fixed activation date.
   */
  const createActiveCommitment = async (label: string) => {
    const user = await register(label);
    const create = await request(app)
      .post('/api/commitments')
      .set(auth(user))
      .send({ planId, dailyTarget: 1, depositAmount: 1000 });
    expect(create.status).toBe(201);
    const commitmentId = create.body.data.id as string;

    mockCreateOrder.mockResolvedValueOnce({
      id: `order_${label}`,
      amount: 100000,
      currency: 'INR',
      status: 'created',
    });
    await PaymentService.createOrder(user.id, commitmentId);

    mockVerifySignature.mockReturnValueOnce(true);
    const activated = await PaymentService.verifyPayment(
      user.id,
      commitmentId,
      {
        razorpayOrderId: `order_${label}`,
        razorpayPaymentId: `pay_${label}`,
        razorpaySignature: 'valid-signature',
      },
      at(`2030-02-01T10:00:00${IST}`)
    );
    expect(activated.status).toBe('ACTIVE');
    expect(activated.startDate).toBe('2030-02-01');
    expect(activated.endDate).toBe('2030-02-03');

    return { user, commitmentId };
  };

  beforeAll(async () => {
    await mongoose.connect(buildTestUri(env.MONGODB_URI));
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      Commitment.init(),
      CommitmentTransaction.init(),
      Plan.init(),
      Problem.init(),
    ]);

    const problems = await Problem.insertMany(
      Array.from({ length: 3 }, (_, i) => ({
        title: `Settlement Problem ${i + 1}`,
        slug: `settlement-problem-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/settlement-problems/${i + 1}`,
        source: 'Test',
        order: i + 1,
      }))
    );
    problemIds = problems.map((p) => p._id.toString());
    const plan = await Plan.create({
      name: 'Settlement Test Plan',
      slug: 'settlement-test-plan',
      description: 'Plan for settlement tests',
      problemIds: problems.map((p) => p._id),
      order: 0,
    });
    planId = plan._id.toString();
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(() => {
    mockIsConfigured.mockReset().mockReturnValue(true);
    mockCreateOrder.mockReset();
    mockVerifySignature.mockReset();
  });

  // 2030-02-01 is a Friday in IST; the commitment above always runs 2030-02-01..03.
  const day1 = at(`2030-02-01T10:00:00${IST}`);
  const day2 = at(`2030-02-02T10:00:00${IST}`);
  const day3 = at(`2030-02-03T10:00:00${IST}`);
  const afterEnd = at(`2030-02-05T10:00:00${IST}`);

  it('queues a full-amount REFUND once every day completes', async () => {
    const { user, commitmentId } = await createActiveCommitment('complete');

    for (const [day, problemId] of [
      [day1, problemIds[0]],
      [day2, problemIds[1]],
      [day3, problemIds[2]],
    ] as const) {
      await DailyProgressService.setProblemCompletion(
        user.id,
        commitmentId,
        { problemId, completed: true },
        day
      );
      await DailyProgressService.completeDay(user.id, commitmentId, day);
    }

    const commitment = await Commitment.findById(commitmentId);
    expect(commitment?.status).toBe('COMPLETED');
    expect(commitment?.currentProtectedAmount).toBe(1000);

    const refund = await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' });
    expect(refund?.status).toBe('PENDING');
    expect(refund?.amount).toBe(1000);
    expect(refund?.razorpayPaymentId).toBe('pay_complete');
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    // Never calls Razorpay's refund API on its own — only the manual script does.
    expect(razorpayClient.refund).not.toHaveBeenCalled();
  });

  it('queues a partial REFUND matching currentProtectedAmount when some days are missed', async () => {
    const { user, commitmentId } = await createActiveCommitment('partial');

    // Complete day 1 only; days 2 and 3 are left to lapse into MISSED.
    await DailyProgressService.setProblemCompletion(
      user.id,
      commitmentId,
      { problemId: problemIds[0], completed: true },
      day1
    );
    await DailyProgressService.completeDay(user.id, commitmentId, day1);

    const progress = await DailyProgressService.getProgress(user.id, commitmentId, afterEnd);
    expect(progress.commitment.status).toBe('FAILED');
    expect(progress.commitment.missedDays).toBe(2);
    expect(progress.commitment.currentForfeitedAmount).toBe(200);
    expect(progress.commitment.currentProtectedAmount).toBe(800);

    const refund = await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' });
    expect(refund?.status).toBe('PENDING');
    expect(refund?.amount).toBe(800);
    expect(refund?.razorpayPaymentId).toBe('pay_partial');
  });

  it('is idempotent under repeated reconcile() calls — never queues a second REFUND row', async () => {
    const { user, commitmentId } = await createActiveCommitment('idempotent');

    await DailyProgressService.setProblemCompletion(
      user.id,
      commitmentId,
      { problemId: problemIds[0], completed: true },
      day1
    );
    await DailyProgressService.completeDay(user.id, commitmentId, day1);

    // Touch reconcile() several times after the commitment has finalized.
    await DailyProgressService.getProgress(user.id, commitmentId, afterEnd);
    await DailyProgressService.getProgress(user.id, commitmentId, afterEnd);
    await DailyProgressService.getProgress(user.id, commitmentId, afterEnd);

    const refunds = await CommitmentTransaction.find({ commitmentId, type: 'REFUND' });
    expect(refunds).toHaveLength(1);
  });

  it('never queues a refund when the entire deposit is forfeited', async () => {
    const { user, commitmentId } = await createActiveCommitment('total-loss');
    // Bump this commitment's own forfeiture rate so missing all 3 days reaches 100% — the
    // default 10%/day would only reach 30% over this plan's 3-day span.
    await Commitment.updateOne(
      { _id: commitmentId },
      { $set: { 'rules.forfeiturePerMissedDay': 40 } }
    );

    // Miss every day.
    await DailyProgressService.getProgress(user.id, commitmentId, afterEnd);

    const commitment = await Commitment.findById(commitmentId);
    expect(commitment?.status).toBe('FAILED');
    expect(commitment?.currentForfeitedAmount).toBe(1000);
    expect(commitment?.currentProtectedAmount).toBe(0);

    const refund = await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' });
    expect(refund).toBeNull();
  });
});
