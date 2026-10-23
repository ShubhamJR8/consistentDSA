import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createHmac } from 'crypto';

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
import { ProcessedWebhookEvent } from '../models/processedWebhookEvent.model.js';
import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { RefundGateway, executeRefund } from '../services/refundExecution.service.js';
import { PaymentWebhookService } from '../services/paymentWebhook.service.js';
import { resolveStartDate } from '../services/commitment.shared.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const TEST_DB = 'commit_dsa_test_payment_lifecycle';
const IST = '+05:30';
const at = (iso: string) => new Date(iso);

const sign = (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

describe('Payment lifecycle: late start, disputes, event dedupe, refunds', () => {
  const app = createApp();
  let planId: string;
  let counter = 0;

  const post = (event: string, payload: unknown, eventId?: string, signature?: string) => {
    const body = JSON.stringify({ event, payload });
    const req = request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature ?? sign(body));
    if (eventId) req.set('X-Razorpay-Event-Id', eventId);
    return req.send(body);
  };

  const setup = async () => {
    counter += 1;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Lifecycle',
        email: `lifecycle-${counter}-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(reg.status).toBe(201);
    const created = await request(app)
      .post('/api/commitments')
      .set({ Cookie: extractAuthCookie(reg) })
      .send({ planId, dailyTarget: 3, depositAmount: 1000 });
    expect(created.status).toBe(201);
    const commitmentId = created.body.data.id as string;
    const userId = reg.body.data.user.id as string;
    return { commitmentId, userId };
  };

  const paidDeposit = async (commitmentId: string, userId: string, n: string) =>
    CommitmentTransaction.create({
      userId,
      commitmentId,
      type: 'DEPOSIT',
      amount: 1000,
      status: 'SUCCESS',
      reference: 'Commitment deposit',
      razorpayOrderId: `order_${n}`,
      razorpayPaymentId: `pay_${n}`,
    });

  const queuedRefund = async (commitmentId: string, userId: string, n: string, extra = {}) =>
    CommitmentTransaction.create({
      userId,
      commitmentId,
      type: 'REFUND',
      amount: 1000,
      status: 'PENDING',
      reference: 'Awaiting manual refund',
      razorpayPaymentId: `pay_${n}`,
      refundReason: 'DUPLICATE_PAYMENT',
      ...extra,
    });

  beforeAll(async () => {
    const match = env.MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
    await mongoose.connect(
      match ? `${match[1]}/${TEST_DB}${match[2] ?? ''}` : `${env.MONGODB_URI}/${TEST_DB}`
    );
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      Commitment.init(),
      CommitmentTransaction.init(),
      ProcessedWebhookEvent.init(),
      User.init(),
    ]);
    const problems = await Problem.insertMany(
      Array.from({ length: 21 }, (_, i) => ({
        title: `Lifecycle ${i + 1}`,
        slug: `lifecycle-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/lifecycle/${i + 1}`,
        source: 'Test',
        order: i + 1,
      }))
    );
    planId = (
      await Plan.create({
        name: 'Lifecycle Plan',
        slug: 'lifecycle-plan',
        description: 'x',
        problemIds: problems.map((p) => p._id),
        order: 0,
      })
    )._id.toString();
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  describe('late-evening payment starts tomorrow', () => {
    it('resolveStartDate: today with enough time left, tomorrow without', () => {
      expect(resolveStartDate(at(`2030-02-01T10:00:00${IST}`), 'Asia/Kolkata', 3)).toBe(
        '2030-02-01'
      );
      expect(resolveStartDate(at(`2030-02-01T20:59:00${IST}`), 'Asia/Kolkata', 3)).toBe(
        '2030-02-01'
      );
      expect(resolveStartDate(at(`2030-02-01T21:01:00${IST}`), 'Asia/Kolkata', 3)).toBe(
        '2030-02-02'
      );
      expect(resolveStartDate(at(`2030-02-01T23:58:00${IST}`), 'Asia/Kolkata', 3)).toBe(
        '2030-02-02'
      );
      expect(resolveStartDate(at(`2030-02-01T23:58:00${IST}`), 'Asia/Kolkata', 0)).toBe(
        '2030-02-01'
      );
    });

    it('uses the commitment timezone, not the server clock, and crosses month ends', () => {
      // 20:00 UTC on Jan 31 is already 01:30 Feb 1 in IST, with plenty of that day left.
      expect(resolveStartDate(at('2030-01-31T20:00:00Z'), 'Asia/Kolkata', 3)).toBe('2030-02-01');
      expect(resolveStartDate(at('2030-01-31T20:00:00Z'), 'UTC', 3)).toBe('2030-01-31'); // 4h left
      expect(resolveStartDate(at('2030-01-31T22:00:00Z'), 'UTC', 3)).toBe('2030-02-01');
    });

    it('activates for tomorrow and materialises every day from there', async () => {
      const { commitmentId, userId } = await setup();
      await CommitmentTransaction.create({
        userId,
        commitmentId,
        type: 'DEPOSIT',
        amount: 1000,
        status: 'PENDING',
        reference: 'd',
        razorpayOrderId: 'order_late',
      });
      env.PAYMENT_MIN_START_HOURS = 3;
      try {
        const outcome = await PaymentWebhookService.applyCapture(
          { id: 'pay_late', orderId: 'order_late', amount: 100000 },
          't',
          at(`2030-02-01T23:58:00${IST}`)
        );
        expect(outcome).toBe('activated');
      } finally {
        env.PAYMENT_MIN_START_HOURS = 0;
      }

      const commitment = (await Commitment.findById(commitmentId))!;
      expect(commitment.status).toBe('ACTIVE');
      expect(commitment.startDate).toBe('2030-02-02');
      const days = await DailyProgress.find({ commitmentId }).sort({ dayNumber: 1 });
      expect(days[0].date).toBe('2030-02-02');
      expect(days).toHaveLength(commitment.durationDays);
    });

    it('forfeits nothing for the evening it skipped', async () => {
      const { commitmentId, userId } = await setup();
      await CommitmentTransaction.create({
        userId,
        commitmentId,
        type: 'DEPOSIT',
        amount: 1000,
        status: 'PENDING',
        reference: 'd',
        razorpayOrderId: 'order_late2',
      });
      env.PAYMENT_MIN_START_HOURS = 3;
      try {
        await PaymentWebhookService.applyCapture(
          { id: 'pay_late2', orderId: 'order_late2', amount: 100000 },
          't',
          at(`2030-02-01T23:58:00${IST}`)
        );
      } finally {
        env.PAYMENT_MIN_START_HOURS = 0;
      }
      const { DailyProgressService } = await import('../services/dailyProgress.service.js');
      const commitment = (await Commitment.findById(commitmentId))!;
      // Just after midnight: the day it skipped is over, and nothing was owed for it.
      await DailyProgressService.reconcile(commitment, at(`2030-02-02T00:30:00${IST}`));
      expect(commitment.missedDays).toBe(0);
      expect(commitment.currentForfeitedAmount).toBe(0);
    });

    it('exposes the projected start while payment is pending, and not afterwards', async () => {
      const { commitmentId, userId } = await setup();
      const { toCommitmentDto } = await import('../services/commitment.shared.js');
      const pending = toCommitmentDto((await Commitment.findById(commitmentId))!);
      expect(pending.projectedStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      await Commitment.updateOne({ _id: commitmentId }, { $set: { status: 'CANCELLED' } });
      expect(
        toCommitmentDto((await Commitment.findById(commitmentId))!).projectedStartDate
      ).toBeNull();
      expect(userId).toBeTruthy();
    });
  });

  describe('disputes and chargebacks', () => {
    const dispute = (event: string, paymentId: string, id = 'disp_1') =>
      post(event, { dispute: { entity: { id, payment_id: paymentId } } });

    it('records an open dispute on the deposit without touching the commitment', async () => {
      const { commitmentId, userId } = await setup();
      await Commitment.updateOne({ _id: commitmentId }, { $set: { status: 'ACTIVE' } });
      await paidDeposit(commitmentId, userId, 'd1');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await dispute('payment.dispute.created', 'pay_d1');
      spy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('dispute_recorded');
      const tx = await CommitmentTransaction.findOne({
        razorpayPaymentId: 'pay_d1',
        type: 'DEPOSIT',
      });
      expect(tx).toMatchObject({ disputeId: 'disp_1', disputeStatus: 'created' });
      expect((await Commitment.findById(commitmentId))?.status).toBe('ACTIVE');
    });

    it('does not let a delayed "created" overwrite a final state', async () => {
      const { commitmentId, userId } = await setup();
      await paidDeposit(commitmentId, userId, 'd2');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await dispute('payment.dispute.won', 'pay_d2');
      await dispute('payment.dispute.created', 'pay_d2'); // arrives late, out of order
      spy.mockRestore();

      const tx = await CommitmentTransaction.findOne({
        razorpayPaymentId: 'pay_d2',
        type: 'DEPOSIT',
      });
      expect(tx?.disputeStatus).toBe('won');
    });

    it('acknowledges a dispute for a payment it does not know', async () => {
      const res = await dispute('payment.dispute.created', 'pay_unknown');
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('unknown_order');
    });

    it('refuses to refund a disputed payment, and allows it once the dispute is won', async () => {
      const { commitmentId, userId } = await setup();
      await paidDeposit(commitmentId, userId, 'd3');
      const refund = await queuedRefund(commitmentId, userId, 'd3');
      const gateway: RefundGateway = {
        findRefundForTransaction: vi.fn().mockResolvedValue(null),
        refund: vi.fn().mockResolvedValue({ id: 'rfnd_d3', amount: 100000, status: 'processed' }),
      };
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await dispute('payment.dispute.lost', 'pay_d3');
      spy.mockRestore();

      const blocked = await executeRefund(refund._id.toString(), gateway);
      expect(blocked.code).toBe('REFUSED');
      expect(blocked.message).toMatch(/dispute/);
      expect(gateway.refund).not.toHaveBeenCalled();
      expect((await CommitmentTransaction.findById(refund._id))?.status).toBe('PENDING');

      await dispute('payment.dispute.won', 'pay_d3');
      const allowed = await executeRefund(refund._id.toString(), gateway);
      expect(allowed.code).toBe('EXECUTED');
    });
  });

  describe('webhook event de-duplication', () => {
    it('handles an event once and short-circuits redeliveries of the same event id', async () => {
      const { commitmentId, userId } = await setup();
      await paidDeposit(commitmentId, userId, 'e1');

      const first = await post(
        'payment.dispute.created',
        { dispute: { entity: { id: 'd', payment_id: 'pay_e1' } } },
        'evt_1'
      );
      const second = await post(
        'payment.dispute.created',
        { dispute: { entity: { id: 'd', payment_id: 'pay_e1' } } },
        'evt_1'
      );

      expect(first.body.data.outcome).toBe('dispute_recorded');
      expect(second.status).toBe(200);
      expect(second.body.data.outcome).toBe('duplicate_event');
      expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_1' })).toBe(1);
    });

    it('does not remember an event whose handling failed, so Razorpay can retry it', async () => {
      const spy = vi.spyOn(Commitment, 'findById').mockRejectedValueOnce(new Error('db blip'));
      const { commitmentId, userId } = await setup();
      spy.mockRestore();
      await CommitmentTransaction.create({
        userId,
        commitmentId,
        type: 'DEPOSIT',
        amount: 1000,
        status: 'PENDING',
        reference: 'd',
        razorpayOrderId: 'order_e2',
      });
      const payload = {
        payment: { entity: { id: 'pay_e2', order_id: 'order_e2', amount: 100000 } },
      };

      const failing = vi.spyOn(Commitment, 'findById').mockRejectedValueOnce(new Error('db blip'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const failed = await post('payment.captured', payload, 'evt_2');
      failing.mockRestore();
      err.mockRestore();
      expect(failed.status).toBe(500);
      expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_2' })).toBe(0);

      const retried = await post('payment.captured', payload, 'evt_2');
      expect(retried.body.data.outcome).toBe('activated');
      expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_2' })).toBe(1);
    });

    it('still handles events that carry no event id', async () => {
      const res = await post('payment.captured', {
        payment: { entity: { id: 'p', order_id: 'order_none', amount: 1 } },
      });
      expect(res.body.data.outcome).toBe('unknown_order');
    });
  });

  describe('refund webhooks reconcile the ledger', () => {
    const refundEvent = (event: string, transactionId: string, id = 'rfnd_1') =>
      post(event, { refund: { entity: { id, notes: { transactionId } } } });

    it('refund.processed rescues a refund the script issued but never recorded', async () => {
      const { commitmentId, userId } = await setup();
      await paidDeposit(commitmentId, userId, 'r1');
      const tx = await queuedRefund(commitmentId, userId, 'r1', { status: 'PROCESSING' });

      const res = await refundEvent('refund.processed', tx._id.toString(), 'rfnd_r1');

      expect(res.body.data.outcome).toBe('refund_reconciled');
      expect(await CommitmentTransaction.findById(tx._id)).toMatchObject({
        status: 'SUCCESS',
        razorpayRefundId: 'rfnd_r1',
      });
    });

    it('refund.failed flags a refund that did not go through', async () => {
      const { commitmentId, userId } = await setup();
      await paidDeposit(commitmentId, userId, 'r2');
      const tx = await queuedRefund(commitmentId, userId, 'r2', { status: 'SUCCESS' });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await refundEvent('refund.failed', tx._id.toString());
      spy.mockRestore();

      expect((await CommitmentTransaction.findById(tx._id))?.status).toBe('FAILED');
    });

    it('ignores refunds this system did not issue', async () => {
      const res = await post('refund.processed', {
        refund: { entity: { id: 'rfnd_x', notes: {} } },
      });
      expect(res.body.data.outcome).toBe('ignored_event');
    });
  });

  describe('crash-safe manual refunds', () => {
    const gateway = (overrides: Partial<RefundGateway> = {}): RefundGateway => ({
      findRefundForTransaction: vi.fn().mockResolvedValue(null),
      refund: vi.fn().mockResolvedValue({ id: 'rfnd_ok', amount: 100000, status: 'processed' }),
      ...overrides,
    });
    const open = async (n: string, extra = {}) => {
      const { commitmentId, userId } = await setup();
      await paidDeposit(commitmentId, userId, n);
      return queuedRefund(commitmentId, userId, n, extra);
    };

    it('issues the refund once, tagged with the ledger row id, and records it', async () => {
      const tx = await open('f1');
      const g = gateway();

      const result = await executeRefund(tx._id.toString(), g);

      expect(result).toMatchObject({ ok: true, code: 'EXECUTED', refundId: 'rfnd_ok' });
      expect(g.refund).toHaveBeenCalledWith('pay_f1', 100000, tx._id.toString());
      expect(await CommitmentTransaction.findById(tx._id)).toMatchObject({
        status: 'SUCCESS',
        razorpayRefundId: 'rfnd_ok',
      });
    });

    it('a crash after Razorpay accepted the refund leaves PROCESSING, and the re-run adopts it instead of refunding again', async () => {
      const tx = await open('f2');
      // Razorpay processed the refund, but the response was lost.
      const first = gateway({ refund: vi.fn().mockRejectedValue(new Error('socket hang up')) });
      const crashed = await executeRefund(tx._id.toString(), first);
      expect(crashed.code).toBe('UNKNOWN_OUTCOME');
      expect((await CommitmentTransaction.findById(tx._id))?.status).toBe('PROCESSING');

      const second = gateway({
        findRefundForTransaction: vi
          .fn()
          .mockResolvedValue({ id: 'rfnd_real', amount: 100000, status: 'processed' }),
      });
      const rerun = await executeRefund(tx._id.toString(), second);

      expect(rerun).toMatchObject({ ok: true, code: 'ADOPTED_EXISTING', refundId: 'rfnd_real' });
      expect(second.refund).not.toHaveBeenCalled();
      expect((await CommitmentTransaction.findById(tx._id))?.status).toBe('SUCCESS');
    });

    it('a re-run with no refund on Razorpay issues exactly one', async () => {
      const tx = await open('f3');
      await executeRefund(
        tx._id.toString(),
        gateway({ refund: vi.fn().mockRejectedValue(new Error('timeout')) })
      );
      const g = gateway();

      const rerun = await executeRefund(tx._id.toString(), g);

      expect(rerun.code).toBe('EXECUTED');
      expect(g.refund).toHaveBeenCalledTimes(1);
    });

    it('does not guess when it cannot check for an existing refund', async () => {
      const tx = await open('f4');
      const g = gateway({ findRefundForTransaction: vi.fn().mockRejectedValue(new Error('down')) });

      const result = await executeRefund(tx._id.toString(), g);

      expect(result.code).toBe('UNKNOWN_OUTCOME');
      expect(g.refund).not.toHaveBeenCalled();
      expect((await CommitmentTransaction.findById(tx._id))?.status).toBe('PROCESSING');
    });

    it('marks a definite Razorpay rejection FAILED rather than leaving it ambiguous', async () => {
      const tx = await open('f5');
      const rejection = Object.assign(new Error('bad'), {
        statusCode: 400,
        error: { description: 'The refund amount is greater than the payment amount' },
      });

      const result = await executeRefund(
        tx._id.toString(),
        gateway({ refund: vi.fn().mockRejectedValue(rejection) })
      );

      expect(result.code).toBe('REJECTED');
      expect((await CommitmentTransaction.findById(tx._id))?.status).toBe('FAILED');
    });

    it('two concurrent runs cannot both issue the refund', async () => {
      const tx = await open('f6');
      const g = gateway({
        refund: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { id: 'rfnd_race', amount: 100000, status: 'processed' };
        }),
      });

      const results = await Promise.all([
        executeRefund(tx._id.toString(), g),
        executeRefund(tx._id.toString(), g),
      ]);

      expect(g.refund).toHaveBeenCalledTimes(1);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => r.code === 'REFUSED')).toHaveLength(1);
    });

    it('will not touch a refund that is already done', async () => {
      const tx = await open('f7', { status: 'SUCCESS' });
      const g = gateway();
      const result = await executeRefund(tx._id.toString(), g);
      expect(result.code).toBe('REFUSED');
      expect(g.refund).not.toHaveBeenCalled();
    });

    it('keeps the existing safeguards: full refund only for a cancelled commitment', async () => {
      const { commitmentId, userId } = await setup(); // PENDING_PAYMENT, not cancelled
      await paidDeposit(commitmentId, userId, 'f8');
      const tx = await queuedRefund(commitmentId, userId, 'f8', { refundReason: 'UNACTIVATABLE' });
      const g = gateway();

      expect((await executeRefund(tx._id.toString(), g)).code).toBe('REFUSED');
      expect(g.refund).not.toHaveBeenCalled();

      await Commitment.updateOne({ _id: commitmentId }, { $set: { status: 'CANCELLED' } });
      expect((await executeRefund(tx._id.toString(), g)).code).toBe('EXECUTED');
    });
  });
});
