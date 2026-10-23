import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createHmac } from 'crypto';

// Set before ./config/env.js is first imported (dotenv never overrides an existing value).
const WEBHOOK_SECRET = vi.hoisted(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_test_secret_value';
  return 'webhook_test_secret_value';
});

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { runPaymentReconciliationSweep } from '../jobs/paymentReconciliation.job.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const TEST_DB = 'commit_dsa_test_payment_webhook';

const buildTestUri = (baseUri: string): string => {
  const match = baseUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
  return match
    ? `${match[1]}/${TEST_DB}${match[2] ?? ''}`
    : `${baseUri.replace(/\/$/, '')}/${TEST_DB}`;
};

const sign = (body: string, secret = WEBHOOK_SECRET): string =>
  createHmac('sha256', secret).update(body).digest('hex');

const captured = (
  orderId: string,
  paymentId: string,
  amountPaise: number,
  event = 'payment.captured'
) =>
  JSON.stringify({
    event,
    payload: {
      payment: {
        entity: { id: paymentId, order_id: orderId, amount: amountPaise, currency: 'INR' },
      },
    },
  });

describe('Razorpay payment webhook', () => {
  const app = createApp();
  let planId: string;
  let counter = 0;

  const post = (body: string, signature: string | undefined = sign(body)) => {
    const req = request(app).post('/api/payments/webhook').set('Content-Type', 'application/json');
    if (signature) req.set('X-Razorpay-Signature', signature);
    return req.send(body);
  };

  /** A PENDING_PAYMENT commitment with the PENDING deposit row /payments/create would have made. */
  const pendingDeposit = async () => {
    counter += 1;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Webhook User',
        email: `webhook-${counter}-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(reg.status).toBe(201);
    const cookie = extractAuthCookie(reg);
    const created = await request(app)
      .post('/api/commitments')
      .set({ Cookie: cookie })
      .send({ planId, dailyTarget: 3, depositAmount: 1000 });
    expect(created.status).toBe(201);
    const commitmentId = created.body.data.id as string;
    const orderId = `order_wh_${counter}`;
    await CommitmentTransaction.create({
      userId: reg.body.data.user.id,
      commitmentId,
      type: 'DEPOSIT',
      amount: 1000,
      status: 'PENDING',
      reference: 'Commitment deposit',
      razorpayOrderId: orderId,
    });
    return { commitmentId, orderId };
  };

  beforeAll(async () => {
    expect(env.RAZORPAY_WEBHOOK_SECRET).toBe(WEBHOOK_SECRET);
    await mongoose.connect(buildTestUri(env.MONGODB_URI));
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      Commitment.init(),
      CommitmentTransaction.init(),
      DailyProgress.init(),
      User.init(),
    ]);
    const problems = await Problem.insertMany(
      Array.from({ length: 21 }, (_, i) => ({
        title: `Webhook Problem ${i + 1}`,
        slug: `webhook-problem-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/webhook-problems/${i + 1}`,
        source: 'Test',
        order: i + 1,
      }))
    );
    const plan = await Plan.create({
      name: 'Webhook Test Plan',
      slug: 'webhook-test-plan',
      description: 'Plan for webhook tests',
      problemIds: problems.map((p) => p._id),
      order: 0,
    });
    planId = plan._id.toString();
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  it('rejects a missing or wrong signature without touching anything', async () => {
    const { commitmentId, orderId } = await pendingDeposit();
    const body = captured(orderId, 'pay_1', 100000);

    expect((await post(body, '')).status).toBe(401);
    expect((await post(body, sign(body, 'some_other_secret'))).status).toBe(401);
    expect((await post(body, 'not-hex')).status).toBe(401);

    expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
    expect((await CommitmentTransaction.findOne({ razorpayOrderId: orderId }))?.status).toBe(
      'PENDING'
    );
  });

  it('rejects a body that was altered after signing', async () => {
    const { orderId } = await pendingDeposit();
    const signed = captured(orderId, 'pay_1', 100000);
    const res = await post(captured(orderId, 'pay_1', 1), sign(signed));
    expect(res.status).toBe(401);
  });

  it('activates a PENDING_PAYMENT commitment when the capture arrives without the browser callback', async () => {
    const { commitmentId, orderId } = await pendingDeposit();

    const res = await post(captured(orderId, 'pay_ok', 100000));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('activated');
    const commitment = await Commitment.findById(commitmentId);
    expect(commitment?.status).toBe('ACTIVE');
    expect(await DailyProgress.countDocuments({ commitmentId })).toBeGreaterThan(0);
    const tx = await CommitmentTransaction.findOne({ razorpayOrderId: orderId });
    expect(tx?.status).toBe('SUCCESS');
    expect(tx?.razorpayPaymentId).toBe('pay_ok');
  });

  it('accepts order.paid the same way', async () => {
    const { commitmentId, orderId } = await pendingDeposit();
    const res = await post(captured(orderId, 'pay_op', 100000, 'order.paid'));
    expect(res.body.data.outcome).toBe('activated');
    expect((await Commitment.findById(commitmentId))?.status).toBe('ACTIVE');
  });

  it('is idempotent: a redelivered event changes nothing', async () => {
    const { commitmentId, orderId } = await pendingDeposit();
    const body = captured(orderId, 'pay_dup', 100000);

    expect((await post(body)).body.data.outcome).toBe('activated');
    const before = await Commitment.findById(commitmentId);
    const progressBefore = await DailyProgress.countDocuments({ commitmentId });

    const again = await post(body);
    expect(again.status).toBe(200);
    expect(again.body.data.outcome).toBe('already_active');
    const after = await Commitment.findById(commitmentId);
    expect(after?.startDate).toBe(before?.startDate);
    expect(await DailyProgress.countDocuments({ commitmentId })).toBe(progressBefore);
  });

  it('does not activate when the captured amount differs from the deposit', async () => {
    const { commitmentId, orderId } = await pendingDeposit();

    const res = await post(captured(orderId, 'pay_short', 100));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('amount_mismatch');
    expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
    expect((await CommitmentTransaction.findOne({ razorpayOrderId: orderId }))?.status).toBe(
      'PENDING'
    );
  });

  it('acknowledges events for orders it does not know and events it does not handle', async () => {
    const unknown = await post(captured('order_nope', 'pay_x', 100000));
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.outcome).toBe('unknown_order');

    const { commitmentId, orderId } = await pendingDeposit();
    const failed = await post(captured(orderId, 'pay_f', 100000, 'payment.failed'));
    expect(failed.status).toBe(200);
    expect(failed.body.data.outcome).toBe('ignored_event');
    expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
  });

  it('refunds, but does not resurrect, a capture for a commitment that never started', async () => {
    const { commitmentId, orderId } = await pendingDeposit();
    await Commitment.updateOne({ _id: commitmentId }, { $set: { status: 'FAILED' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await post(captured(orderId, 'pay_late', 100000));
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('cancelled_refund_queued');
    expect((await Commitment.findById(commitmentId))?.status).toBe('FAILED');
    const refund = await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' });
    expect(refund).toMatchObject({
      amount: 1000,
      status: 'PENDING',
      razorpayPaymentId: 'pay_late',
      refundReason: 'UNACTIVATABLE',
    });
  });

  it('rejects a body that is not JSON', async () => {
    const body = 'not json';
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEBHOOK_PAYLOAD_INVALID');
  });

  describe('reconciliation sweep', () => {
    // Deposits are created "now"; the sweep is run an hour later so they are past the minimum age.
    const later = () => new Date(Date.now() + 60 * 60_000);
    const client = (payments: Array<{ id: string; amount: number; status: string }>) => ({
      fetchOrderPayments: vi.fn().mockResolvedValue(payments),
    });

    it('activates a commitment whose payment was captured but never reported to us', async () => {
      const { commitmentId, orderId } = await pendingDeposit();
      const fake = client([{ id: 'pay_rec', amount: 100000, status: 'captured' }]);

      const activated = await runPaymentReconciliationSweep(later(), fake);

      expect(activated).toBeGreaterThanOrEqual(1);
      expect(fake.fetchOrderPayments).toHaveBeenCalledWith(orderId);
      expect((await Commitment.findById(commitmentId))?.status).toBe('ACTIVE');
      const tx = await CommitmentTransaction.findOne({ razorpayOrderId: orderId });
      expect(tx?.status).toBe('SUCCESS');
      expect(tx?.razorpayPaymentId).toBe('pay_rec');
    });

    it('leaves unpaid and merely authorized orders alone', async () => {
      const { commitmentId, orderId } = await pendingDeposit();

      await runPaymentReconciliationSweep(
        later(),
        client([
          { id: 'pay_a', amount: 100000, status: 'failed' },
          { id: 'pay_b', amount: 100000, status: 'authorized' },
        ])
      );

      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
      expect((await CommitmentTransaction.findOne({ razorpayOrderId: orderId }))?.status).toBe(
        'PENDING'
      );
    });

    it('does not touch deposits younger than the minimum age', async () => {
      const { commitmentId } = await pendingDeposit();
      const fake = client([{ id: 'pay_new', amount: 100000, status: 'captured' }]);

      await runPaymentReconciliationSweep(new Date(), fake);

      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
    });

    it('skips commitments that are no longer awaiting payment without calling Razorpay', async () => {
      const { commitmentId, orderId } = await pendingDeposit();
      await Commitment.updateOne({ _id: commitmentId }, { $set: { status: 'FAILED' } });
      const fake = client([{ id: 'pay_skip', amount: 100000, status: 'captured' }]);

      await runPaymentReconciliationSweep(later(), fake);

      expect(fake.fetchOrderPayments).not.toHaveBeenCalledWith(orderId);
    });

    it('does not activate on a captured amount that differs from the deposit', async () => {
      const { commitmentId } = await pendingDeposit();

      await runPaymentReconciliationSweep(
        later(),
        client([{ id: 'pay_short', amount: 100, status: 'captured' }])
      );

      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
    });

    it('survives a Razorpay failure and still processes the rest', async () => {
      const bad = await pendingDeposit();
      const good = await pendingDeposit();
      const fake = {
        fetchOrderPayments: vi.fn().mockImplementation(async (orderId: string) => {
          if (orderId === bad.orderId) throw new Error('razorpay down');
          return [{ id: 'pay_good', amount: 100000, status: 'captured' }];
        }),
      };
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await runPaymentReconciliationSweep(later(), fake);
      spy.mockRestore();

      expect((await Commitment.findById(bad.commitmentId))?.status).toBe('PENDING_PAYMENT');
      expect((await Commitment.findById(good.commitmentId))?.status).toBe('ACTIVE');
    });
  });
});
