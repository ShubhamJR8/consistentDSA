import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

let orderSeq = 0;
vi.mock('../integrations/razorpay/razorpay.client.js', () => ({
  isRazorpayConfigured: vi.fn(() => true),
  razorpayClient: {
    createOrder: vi.fn(),
    verifyCheckoutSignature: vi.fn(),
    fetchPayment: vi.fn(),
    fetchOrderPayments: vi.fn(),
  },
}));

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { runPaymentReconciliationSweep } from '../jobs/paymentReconciliation.job.js';
import { razorpayClient } from '../integrations/razorpay/razorpay.client.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { PaymentWebhookService } from '../services/paymentWebhook.service.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const createOrder = vi.mocked(razorpayClient.createOrder);
const verifySignature = vi.mocked(razorpayClient.verifyCheckoutSignature);
const fetchPayment = vi.mocked(razorpayClient.fetchPayment);
const fetchOrderPayments = vi.mocked(razorpayClient.fetchOrderPayments);

const TEST_DB = 'commit_dsa_test_payment_hardening';
const later = () => new Date(Date.now() + 60 * 60_000);

describe('Payment hardening (adversarial cases)', () => {
  const app = createApp();
  let planId: string;
  let allProblemIds: mongoose.Types.ObjectId[];
  let counter = 0;

  const setup = async () => {
    counter += 1;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Hardening',
        email: `hardening-${counter}-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(reg.status).toBe(201);
    await User.updateOne({ _id: reg.body.data.user.id }, { $set: { emailVerified: true } });
    const cookie = extractAuthCookie(reg);
    const created = await request(app)
      .post('/api/commitments')
      .set({ Cookie: cookie })
      .send({ planId, dailyTarget: 3, depositAmount: 1000 });
    expect(created.status).toBe(201);
    return { cookie, commitmentId: created.body.data.id as string };
  };

  const pay = (cookie: string, commitmentId: string) =>
    request(app).post('/api/payments/create').set({ Cookie: cookie }).send({ commitmentId });

  const verify = (cookie: string, commitmentId: string, order: string, payment: string) =>
    request(app).post('/api/payments/verify').set({ Cookie: cookie }).send({
      commitmentId,
      razorpayOrderId: order,
      razorpayPaymentId: payment,
      razorpaySignature: 'sig',
    });

  /** A deposit row as /payments/create leaves it, with a given order id. */
  const deposit = async (commitmentId: string, orderId: string) => {
    const commitment = (await Commitment.findById(commitmentId))!;
    return CommitmentTransaction.create({
      userId: commitment.userId,
      commitmentId,
      type: 'DEPOSIT',
      amount: 1000,
      status: 'PENDING',
      reference: 'Commitment deposit',
      razorpayOrderId: orderId,
    });
  };

  const captured = (id: string, orderId: string, amount = 100000) => ({
    id,
    orderId,
    amount,
    status: 'captured',
  });

  beforeAll(async () => {
    const match = env.MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
    await mongoose.connect(
      match ? `${match[1]}/${TEST_DB}${match[2] ?? ''}` : `${env.MONGODB_URI}/${TEST_DB}`
    );
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([Commitment.init(), CommitmentTransaction.init(), User.init()]);
    const problems = await Problem.insertMany(
      Array.from({ length: 21 }, (_, i) => ({
        title: `Hardening ${i + 1}`,
        slug: `hardening-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/hardening/${i + 1}`,
        source: 'Test',
        order: i + 1,
      }))
    );
    allProblemIds = problems.map((p) => p._id);
    planId = (
      await Plan.create({
        name: 'Hardening Plan',
        slug: 'hardening-plan',
        description: 'x',
        problemIds: allProblemIds,
        order: 0,
      })
    )._id.toString();
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(() => {
    createOrder.mockReset().mockImplementation(async () => {
      orderSeq += 1;
      const id = `order_h_${orderSeq}`;
      await new Promise((resolve) => setTimeout(resolve, 25)); // gateway latency
      return { id, amount: 100000, currency: 'INR', status: 'created' };
    });
    verifySignature.mockReset().mockReturnValue(true);
    fetchPayment.mockReset();
    fetchOrderPayments.mockReset();
  });

  describe('double-click / multi-tab order creation', () => {
    it('hands every concurrent request the same single order', async () => {
      const { cookie, commitmentId } = await setup();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => pay(cookie, commitmentId))
      );

      const ok = responses.filter((r) => r.status === 201);
      const busy = responses.filter((r) => r.status === 409);
      expect(ok.length + busy.length).toBe(5);
      expect(busy.every((r) => r.body.error.code === 'ORDER_IN_PROGRESS')).toBe(true);
      expect(new Set(ok.map((r) => r.body.data.orderId)).size).toBe(1);
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(await CommitmentTransaction.countDocuments({ commitmentId, type: 'DEPOSIT' })).toBe(1);

      // Once the winner has saved its order, a retry simply gets that same order back.
      const retry = await pay(cookie, commitmentId);
      expect(retry.status).toBe(201);
      expect(retry.body.data.orderId).toBe(ok[0].body.data.orderId);
    });

    it('releases the slot when the gateway fails, so a retry works', async () => {
      const { cookie, commitmentId } = await setup();
      createOrder.mockReset().mockRejectedValueOnce(new Error('gateway timeout'));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const failed = await pay(cookie, commitmentId);
      spy.mockRestore();
      expect(failed.status).toBe(503);
      expect(failed.body.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
      expect(await CommitmentTransaction.countDocuments({ commitmentId })).toBe(0);

      createOrder.mockResolvedValueOnce({
        id: 'order_retry_ok',
        amount: 100000,
        currency: 'INR',
        status: 'created',
      });
      const retry = await pay(cookie, commitmentId);
      expect(retry.status).toBe(201);
      expect(retry.body.data.orderId).toBe('order_retry_ok');
    });

    it('takes over a reservation whose creator died before saving an order', async () => {
      const { cookie, commitmentId } = await setup();
      const commitment = (await Commitment.findById(commitmentId))!;
      const stale = await CommitmentTransaction.create({
        userId: commitment.userId,
        commitmentId,
        type: 'DEPOSIT',
        amount: 1000,
        status: 'PENDING',
        reference: 'Commitment deposit',
      });
      await CommitmentTransaction.collection.updateOne(
        { _id: stale._id },
        { $set: { createdAt: new Date(Date.now() - 5 * 60_000) } }
      );

      const res = await pay(cookie, commitmentId);

      expect(res.status).toBe(201);
      expect(await CommitmentTransaction.countDocuments({ commitmentId })).toBe(1);
    });

    it('refuses a new order once a payment has been received', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_paid_already');
      await CommitmentTransaction.updateOne(
        { razorpayOrderId: 'order_paid_already' },
        { $set: { status: 'SUCCESS', razorpayPaymentId: 'pay_paid_already' } }
      );

      const res = await pay(cookie, commitmentId);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_ALREADY_RECEIVED');
      expect(createOrder).not.toHaveBeenCalled();
    });
  });

  describe('second payment for the same commitment', () => {
    it('records exactly one deposit and queues a full refund for the extra payment', async () => {
      const { commitmentId } = await setup();
      await deposit(commitmentId, 'order_x1');
      // Two paid orders can only coexist if the second was minted while the first was unsettled;
      // the pending-deposit index now prevents that, so move x1 out of PENDING to model it.
      await CommitmentTransaction.updateOne(
        { razorpayOrderId: 'order_x1' },
        { $set: { status: 'FAILED' } }
      );
      await deposit(commitmentId, 'order_x2');

      const first = await PaymentWebhookService.applyCapture(
        { id: 'pay_x1', orderId: 'order_x1', amount: 100000 },
        't'
      );
      const second = await PaymentWebhookService.applyCapture(
        { id: 'pay_x2', orderId: 'order_x2', amount: 100000 },
        't'
      );

      expect(first).toBe('activated');
      expect(second).toBe('duplicate_refund_queued');
      expect(
        await CommitmentTransaction.countDocuments({
          commitmentId,
          type: 'DEPOSIT',
          status: 'SUCCESS',
        })
      ).toBe(1);
      const refund = await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' });
      expect(refund).toMatchObject({
        amount: 1000,
        status: 'PENDING',
        razorpayPaymentId: 'pay_x2',
        refundReason: 'DUPLICATE_PAYMENT',
      });
      expect((await Commitment.findById(commitmentId))?.status).toBe('ACTIVE');
    });

    it('is idempotent: replaying the duplicate does not queue a second refund', async () => {
      const { commitmentId } = await setup();
      await deposit(commitmentId, 'order_y1');
      await PaymentWebhookService.applyCapture(
        { id: 'pay_y1', orderId: 'order_y1', amount: 100000 },
        't'
      );
      await CommitmentTransaction.create({
        userId: (await Commitment.findById(commitmentId))!.userId,
        commitmentId,
        type: 'DEPOSIT',
        amount: 1000,
        status: 'PENDING',
        reference: 'Commitment deposit',
        razorpayOrderId: 'order_y2',
      });

      for (let i = 0; i < 3; i += 1) {
        await PaymentWebhookService.applyCapture(
          { id: 'pay_y2', orderId: 'order_y2', amount: 100000 },
          't'
        );
      }

      expect(await CommitmentTransaction.countDocuments({ commitmentId, type: 'REFUND' })).toBe(1);
      // The legitimate payment replaying must never be refunded.
      await PaymentWebhookService.applyCapture(
        { id: 'pay_y1', orderId: 'order_y1', amount: 100000 },
        't'
      );
      expect(await CommitmentTransaction.countDocuments({ commitmentId, type: 'REFUND' })).toBe(1);
    });

    it('lets only one of two simultaneous captures win', async () => {
      const { commitmentId } = await setup();
      await deposit(commitmentId, 'order_z1');
      await CommitmentTransaction.updateOne(
        { razorpayOrderId: 'order_z1' },
        { $set: { status: 'FAILED' } }
      );
      await deposit(commitmentId, 'order_z2');
      await CommitmentTransaction.updateOne(
        { razorpayOrderId: 'order_z1' },
        { $set: { status: 'PENDING' } }
      ).catch(() => undefined);

      const outcomes = await Promise.all([
        PaymentWebhookService.applyCapture(
          { id: 'pay_z1', orderId: 'order_z1', amount: 100000 },
          't'
        ),
        PaymentWebhookService.applyCapture(
          { id: 'pay_z2', orderId: 'order_z2', amount: 100000 },
          't'
        ),
      ]);

      expect(
        await CommitmentTransaction.countDocuments({
          commitmentId,
          type: 'DEPOSIT',
          status: 'SUCCESS',
        })
      ).toBe(1);
      expect(outcomes.filter((o) => o === 'duplicate_refund_queued')).toHaveLength(1);
      expect(await CommitmentTransaction.countDocuments({ commitmentId, type: 'REFUND' })).toBe(1);
    });

    it('answers the browser callback for a duplicate with DUPLICATE_PAYMENT, not success', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_w1');
      await PaymentWebhookService.applyCapture(
        { id: 'pay_w1', orderId: 'order_w1', amount: 100000 },
        't'
      );
      await deposit(commitmentId, 'order_w2');
      fetchPayment.mockResolvedValue(captured('pay_w2', 'order_w2'));

      const res = await verify(cookie, commitmentId, 'order_w2', 'pay_w2');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_PAYMENT');
    });
  });

  describe('browser verification', () => {
    it('rejects a bad signature without changing any state, so reconciliation can still recover', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_s1');
      verifySignature.mockReturnValue(false);

      const res = await verify(cookie, commitmentId, 'order_s1', 'pay_s1');
      expect(res.status).toBe(400);
      expect((await CommitmentTransaction.findOne({ razorpayOrderId: 'order_s1' }))?.status).toBe(
        'PENDING'
      );

      fetchOrderPayments.mockResolvedValue([captured('pay_real', 'order_s1')]);
      await runPaymentReconciliationSweep(later(), razorpayClient);
      expect((await Commitment.findById(commitmentId))?.status).toBe('ACTIVE');
    });

    it('does not activate on a payment that is only authorized, not captured', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_a1');
      fetchPayment.mockResolvedValue({ ...captured('pay_a1', 'order_a1'), status: 'authorized' });

      const res = await verify(cookie, commitmentId, 'order_a1', 'pay_a1');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_NOT_CAPTURED');
      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
    });

    it('does not activate on a payment that belongs to a different order', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_m1');
      fetchPayment.mockResolvedValue(captured('pay_m1', 'order_someone_else'));

      const res = await verify(cookie, commitmentId, 'order_m1', 'pay_m1');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_ORDER_MISMATCH');
      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
    });

    it('does not activate when the captured amount is not the deposit', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_p1');
      fetchPayment.mockResolvedValue(captured('pay_p1', 'order_p1', 100));

      const res = await verify(cookie, commitmentId, 'order_p1', 'pay_p1');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');
    });

    it('tells the user to wait, and activates later, when Razorpay cannot be reached', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_g1');
      fetchPayment.mockRejectedValue(new Error('timeout'));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await verify(cookie, commitmentId, 'order_g1', 'pay_g1');
      spy.mockRestore();

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');

      fetchOrderPayments.mockResolvedValue([captured('pay_g1', 'order_g1')]);
      await runPaymentReconciliationSweep(later(), razorpayClient);
      expect((await Commitment.findById(commitmentId))?.status).toBe('ACTIVE');
    });
  });

  describe('paid but the commitment cannot start', () => {
    const breakPlan = (commitmentId: string) =>
      Commitment.findById(commitmentId).then((c) =>
        Plan.updateOne({ _id: c!.planId }, { $set: { problemIds: [] } })
      );
    const restorePlan = () =>
      Plan.updateOne({ _id: planId }, { $set: { problemIds: allProblemIds } });

    it('cancels the commitment, queues a full refund and frees the user', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_k1');
      await breakPlan(commitmentId);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const outcome = await PaymentWebhookService.applyCapture(
        { id: 'pay_k1', orderId: 'order_k1', amount: 100000 },
        't'
      );
      spy.mockRestore();
      await restorePlan();

      expect(outcome).toBe('cancelled_refund_queued');
      expect((await Commitment.findById(commitmentId))?.status).toBe('CANCELLED');
      expect(await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' })).toMatchObject({
        amount: 1000,
        status: 'PENDING',
        razorpayPaymentId: 'pay_k1',
        refundReason: 'UNACTIVATABLE',
      });
      // The single open-commitment slot is free again.
      const next = await request(app)
        .post('/api/commitments')
        .set({ Cookie: cookie })
        .send({ planId, dailyTarget: 3, depositAmount: 1000 });
      expect(next.status).toBe(201);
    });

    it('the sweep retries a recorded payment whose activation failed transiently', async () => {
      const { commitmentId } = await setup();
      const tx = await deposit(commitmentId, 'order_k2');
      await CommitmentTransaction.updateOne(
        { _id: tx._id },
        { $set: { status: 'SUCCESS', razorpayPaymentId: 'pay_k2' } }
      );
      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');

      await runPaymentReconciliationSweep(later(), razorpayClient);

      expect((await Commitment.findById(commitmentId))?.status).toBe('ACTIVE');
      expect(fetchOrderPayments).not.toHaveBeenCalledWith('order_k2');
    });
  });

  describe('cancelling an unpaid commitment', () => {
    const cancel = (cookie: string, commitmentId: string) =>
      request(app).post(`/api/commitments/${commitmentId}/cancel`).set({ Cookie: cookie });

    it('cancels an unpaid commitment and frees the slot', async () => {
      const { cookie, commitmentId } = await setup();

      const res = await cancel(cookie, commitmentId);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      const next = await request(app)
        .post('/api/commitments')
        .set({ Cookie: cookie })
        .send({ planId, dailyTarget: 3, depositAmount: 1000 });
      expect(next.status).toBe(201);
    });

    it("won't cancel someone else's commitment or one that was already paid", async () => {
      const mine = await setup();
      const other = await setup();
      expect((await cancel(other.cookie, mine.commitmentId)).status).toBe(404);

      await deposit(mine.commitmentId, 'order_c1');
      await CommitmentTransaction.updateOne(
        { razorpayOrderId: 'order_c1' },
        { $set: { status: 'SUCCESS', razorpayPaymentId: 'pay_c1' } }
      );
      const res = await cancel(mine.cookie, mine.commitmentId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_ALREADY_RECEIVED');
    });

    it('refunds a payment that was in flight when the user cancelled', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_c2');
      await cancel(cookie, commitmentId);

      const outcome = await PaymentWebhookService.applyCapture(
        { id: 'pay_c2', orderId: 'order_c2', amount: 100000 },
        't'
      );

      expect(outcome).toBe('cancelled_refund_queued');
      expect((await Commitment.findById(commitmentId))?.status).toBe('CANCELLED');
      expect((await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' }))?.amount).toBe(
        1000
      );
    });

    it('the sweep also finds a payment made on a cancelled commitment', async () => {
      const { cookie, commitmentId } = await setup();
      await deposit(commitmentId, 'order_c3');
      await cancel(cookie, commitmentId);
      fetchOrderPayments.mockResolvedValue([captured('pay_c3', 'order_c3')]);

      await runPaymentReconciliationSweep(later(), razorpayClient);

      expect(
        (await CommitmentTransaction.findOne({ commitmentId, type: 'REFUND' }))?.razorpayPaymentId
      ).toBe('pay_c3');
    });
  });
});
