import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { runCommitmentSettlementSweep } from '../jobs/commitmentSettlement.job.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { DailyProgress } from '../models/dailyProgress.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { CommitmentService } from '../services/commitment.service.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import { PaymentWebhookService } from '../services/paymentWebhook.service.js';
import { runPaymentReconciliationSweep } from '../jobs/paymentReconciliation.job.js';
import * as settlement from '../services/settlement.service.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const TEST_DB = 'commit_dsa_test_money_integrity';
const IST = '+05:30';
const start = new Date(`2031-05-01T12:00:00${IST}`);
const at = (iso: string) => new Date(`${iso}${IST}`);

// Local MongoDB is a standalone server, so multi-document transactions are unavailable. These tests
// pin the alternative guarantee: every money-moving sequence is ordered, idempotent and repairable,
// so a crash or a race at ANY step ends in the same state as an uninterrupted run.
describe('money-path integrity under crashes and races', () => {
  const app = createApp();
  let planId: string;
  let counter = 0;
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });
  const quiet = (method: 'error' | 'warn' | 'log') => {
    const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
    spies.push(spy);
    return spy;
  };

  const register = async () => {
    counter += 1;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Integrity User',
        email: `integrity-${counter}-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(reg.status).toBe(201);
    return { userId: reg.body.data.user.id as string, cookie: extractAuthCookie(reg) };
  };

  /** An ACTIVE commitment that began on 2031-05-01 (7 days, 3 problems a day). */
  const active = async () => {
    const { userId, cookie } = await register();
    const created = await request(app)
      .post('/api/commitments')
      .set({ Cookie: cookie })
      .send({ planId, dailyTarget: 3, depositAmount: 1000 });
    expect(created.status).toBe(201);
    const commitmentId = created.body.data.id as string;
    await CommitmentService.activateForDev(userId, commitmentId, start);
    return { userId, commitmentId };
  };

  const pendingPayment = async () => {
    const { userId, cookie } = await register();
    const created = await request(app)
      .post('/api/commitments')
      .set({ Cookie: cookie })
      .send({ planId, dailyTarget: 3, depositAmount: 1000 });
    const commitmentId = created.body.data.id as string;
    return { userId, commitmentId };
  };

  const deposit = (
    userId: string,
    commitmentId: string,
    n: string,
    status: 'PENDING' | 'SUCCESS'
  ) =>
    CommitmentTransaction.create({
      userId,
      commitmentId,
      type: 'DEPOSIT',
      amount: 1000,
      status,
      reference: 'Commitment deposit',
      razorpayOrderId: `order_${n}`,
      ...(status === 'SUCCESS' ? { razorpayPaymentId: `pay_${n}` } : {}),
    });

  const forfeitures = (commitmentId: string) =>
    CommitmentTransaction.find({ commitmentId, type: 'FORFEITURE' }).sort({ dayKey: 1 });
  const refunds = (commitmentId: string) =>
    CommitmentTransaction.find({ commitmentId, type: 'REFUND' });

  beforeAll(async () => {
    const match = env.MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
    await mongoose.connect(
      match ? `${match[1]}/${TEST_DB}${match[2] ?? ''}` : `${env.MONGODB_URI}/${TEST_DB}`
    );
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([Commitment.init(), CommitmentTransaction.init(), DailyProgress.init()]);
    const problems = await Problem.insertMany(
      Array.from({ length: 21 }, (_, i) => ({
        title: `Integrity ${i + 1}`,
        slug: `integrity-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/integrity/${i + 1}`,
        source: 'Test',
        order: i + 1,
      }))
    );
    planId = (
      await Plan.create({
        name: 'Integrity Plan',
        slug: 'integrity-plan',
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

  describe('forfeiture ledger', () => {
    const later = at('2031-05-03T12:00:00'); // days 1 and 2 are over, unfinished

    it('writes one row per missed day even when many reconciles race', async () => {
      const { commitmentId } = await active();

      await Promise.all(
        Array.from({ length: 6 }, async () =>
          DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, later)
        )
      );

      const rows = await forfeitures(commitmentId);
      expect(rows.map((r) => r.dayKey)).toEqual(['2031-05-01', '2031-05-02']);
      expect(rows.every((r) => r.amount === 100 && r.status === 'SUCCESS')).toBe(true);
      const commitment = (await Commitment.findById(commitmentId))!;
      expect(commitment.missedDays).toBe(2);
      expect(commitment.currentForfeitedAmount).toBe(200);
      expect(await DailyProgress.countDocuments({ commitmentId, forfeitureLogged: false })).toBe(0);
    });

    it('a crash after the days were claimed but before the rows were written is repaired by the next reconcile', async () => {
      const { commitmentId } = await active();
      quiet('error');
      const crash = vi
        .spyOn(CommitmentTransaction, 'insertMany')
        .mockRejectedValueOnce(new Error('process died'));
      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, later).catch(
        () => undefined
      );
      crash.mockRestore();

      // The days are decided but the ledger is behind; this is the state that used to be permanent.
      expect(await DailyProgress.countDocuments({ commitmentId, forfeitureLogged: false })).toBe(2);
      expect(await forfeitures(commitmentId)).toHaveLength(0);

      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, later);

      expect((await forfeitures(commitmentId)).map((r) => r.dayKey)).toEqual([
        '2031-05-01',
        '2031-05-02',
      ]);
      expect(await DailyProgress.countDocuments({ commitmentId, forfeitureLogged: false })).toBe(0);
    });

    it('a crash after the rows were written but before the flag was cleared does not double-record', async () => {
      const { commitmentId } = await active();
      quiet('error');
      const crash = vi
        .spyOn(DailyProgress, 'updateMany')
        .mockRejectedValueOnce(new Error('process died'));
      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, later).catch(
        () => undefined
      );
      crash.mockRestore();
      expect(await forfeitures(commitmentId)).toHaveLength(2);

      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, later);
      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, later);

      expect(await forfeitures(commitmentId)).toHaveLength(2);
      expect(await DailyProgress.countDocuments({ commitmentId, forfeitureLogged: false })).toBe(0);
    });

    it('a day that is still pending is never recorded, and recording survives a partial overlap', async () => {
      const { commitmentId } = await active();
      await DailyProgressService.reconcile(
        (await Commitment.findById(commitmentId))!,
        at('2031-05-02T12:00:00')
      );
      expect((await forfeitures(commitmentId)).map((r) => r.dayKey)).toEqual(['2031-05-01']);

      // A later reconcile adds only the newly missed day; the first is not repeated.
      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, later);
      expect((await forfeitures(commitmentId)).map((r) => r.dayKey)).toEqual([
        '2031-05-01',
        '2031-05-02',
      ]);
    });

    it('the ledger always agrees with the commitment totals', async () => {
      const { commitmentId } = await active();
      await Promise.all(
        [1, 2, 3].map(async () =>
          DailyProgressService.reconcile(
            (await Commitment.findById(commitmentId))!,
            at('2031-05-05T12:00:00')
          )
        )
      );
      const commitment = (await Commitment.findById(commitmentId))!;
      const ledger = (await forfeitures(commitmentId)).reduce((sum, r) => sum + r.amount, 0);
      expect(ledger).toBe(commitment.currentForfeitedAmount);
    });
  });

  describe('refund after settlement', () => {
    const end = at('2031-05-20T12:00:00'); // every day is over

    it('a crash between finalizing and queuing the refund is repaired by the settlement sweep', async () => {
      const { userId, commitmentId } = await active();
      await deposit(userId, commitmentId, 's1', 'SUCCESS');
      quiet('error');
      const crash = vi
        .spyOn(settlement, 'queueRefundIfEligible')
        .mockRejectedValueOnce(new Error('process died'));
      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, end).catch(
        () => undefined
      );
      crash.mockRestore();

      // Finalized, money still owed, nothing recorded: and reconcile() will never look again.
      const stuck = (await Commitment.findById(commitmentId))!;
      expect(stuck.status).toBe('FAILED');
      expect(stuck.currentProtectedAmount).toBe(300);
      await DailyProgressService.reconcile(stuck, end);
      expect(await refunds(commitmentId)).toHaveLength(0);

      await runCommitmentSettlementSweep(end);

      const queued = await refunds(commitmentId);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        amount: 300,
        status: 'PENDING',
        razorpayPaymentId: 'pay_s1',
        refundReason: 'SETTLEMENT',
      });
    });

    it('the repair is idempotent and never queues a second refund', async () => {
      const { userId, commitmentId } = await active();
      await deposit(userId, commitmentId, 's2', 'SUCCESS');
      await DailyProgressService.reconcile((await Commitment.findById(commitmentId))!, end);
      expect(await refunds(commitmentId)).toHaveLength(1);

      await runCommitmentSettlementSweep(end);
      await runCommitmentSettlementSweep(end);
      await settlement.queueMissingRefunds();

      expect(await refunds(commitmentId)).toHaveLength(1);
    });

    it('does not invent a refund where none is owed: no deposit, nothing left, or still running', async () => {
      const noDeposit = await active(); // finalized below, but nothing was ever paid
      const fullyForfeited = await active();
      await deposit(fullyForfeited.userId, fullyForfeited.commitmentId, 's3', 'SUCCESS');
      await Commitment.updateOne(
        { _id: fullyForfeited.commitmentId },
        { $set: { status: 'FAILED', currentProtectedAmount: 0, currentForfeitedAmount: 1000 } }
      );
      const running = await active();
      await deposit(running.userId, running.commitmentId, 's4', 'SUCCESS');
      await DailyProgressService.reconcile(
        (await Commitment.findById(noDeposit.commitmentId))!,
        end
      );

      await runCommitmentSettlementSweep(at('2031-05-02T08:00:00'));

      expect(await refunds(noDeposit.commitmentId)).toHaveLength(0);
      expect(await refunds(fullyForfeited.commitmentId)).toHaveLength(0);
      expect(await refunds(running.commitmentId)).toHaveLength(0);
    });
  });

  describe('payment branches: owed money is recorded before state changes', () => {
    it('duplicate payment: a crash between the refund and marking the row FAILED is finished by the redelivery', async () => {
      const { userId, commitmentId } = await pendingPayment();
      await deposit(userId, commitmentId, 'dup1', 'PENDING');
      await PaymentWebhookService.applyCapture(
        { id: 'pay_dup1', orderId: 'order_dup1', amount: 100000 },
        't'
      );
      // A second order for the same commitment, captured too.
      await CommitmentTransaction.create({
        userId,
        commitmentId,
        type: 'DEPOSIT',
        amount: 1000,
        status: 'PENDING',
        reference: 'Commitment deposit',
        razorpayOrderId: 'order_dup2',
      });
      quiet('error');
      const realUpdate = CommitmentTransaction.updateOne.bind(CommitmentTransaction);
      let armed = true;
      const crash = vi.spyOn(CommitmentTransaction, 'updateOne').mockImplementation(((
        ...args: Parameters<typeof realUpdate>
      ) => {
        const [, update] = args as [unknown, { $set?: { status?: string } }];
        if (armed && update?.$set?.status === 'FAILED') {
          armed = false;
          return Promise.reject(new Error('process died'));
        }
        return realUpdate(...args);
      }) as typeof realUpdate);

      await PaymentWebhookService.applyCapture(
        { id: 'pay_dup2', orderId: 'order_dup2', amount: 100000 },
        't'
      ).catch(() => undefined);
      crash.mockRestore();

      // The money owed is already on record even though the row was never marked.
      expect((await refunds(commitmentId)).map((r) => r.razorpayPaymentId)).toEqual(['pay_dup2']);

      const outcome = await PaymentWebhookService.applyCapture(
        { id: 'pay_dup2', orderId: 'order_dup2', amount: 100000 },
        't'
      );
      expect(outcome).toBe('duplicate_refund_queued');
      expect(await refunds(commitmentId)).toHaveLength(1);
      expect((await CommitmentTransaction.findOne({ razorpayOrderId: 'order_dup2' }))?.status).toBe(
        'FAILED'
      );
    });

    it('unstartable commitment: a crash between the refund and the cancellation is re-driven by the sweep', async () => {
      const { userId, commitmentId } = await pendingPayment();
      await deposit(userId, commitmentId, 'un1', 'PENDING');
      const planOf = (await Commitment.findById(commitmentId))!.planId;
      const problemIds = (await Plan.findById(planOf))!.problemIds;
      await Plan.updateOne({ _id: planOf }, { $set: { problemIds: [] } });
      quiet('error');
      const realUpdate = Commitment.updateOne.bind(Commitment);
      let armed = true;
      const crash = vi.spyOn(Commitment, 'updateOne').mockImplementation(((
        ...args: Parameters<typeof realUpdate>
      ) => {
        const [, update] = args as [unknown, { $set?: { status?: string } }];
        if (armed && update?.$set?.status === 'CANCELLED') {
          armed = false;
          return Promise.reject(new Error('process died'));
        }
        return realUpdate(...args);
      }) as typeof realUpdate);

      await PaymentWebhookService.applyCapture(
        { id: 'pay_un1', orderId: 'order_un1', amount: 100000 },
        't'
      ).catch(() => undefined);
      crash.mockRestore();

      // Refund recorded, commitment not yet cancelled, payment recorded: the sweep's second pass.
      expect((await refunds(commitmentId))[0]).toMatchObject({
        razorpayPaymentId: 'pay_un1',
        refundReason: 'UNACTIVATABLE',
      });
      expect((await Commitment.findById(commitmentId))?.status).toBe('PENDING_PAYMENT');

      await runPaymentReconciliationSweep(new Date(Date.now() + 3_600_000), {
        fetchOrderPayments: vi.fn().mockResolvedValue([]),
      });
      await Plan.updateOne({ _id: planOf }, { $set: { problemIds } });

      expect((await Commitment.findById(commitmentId))?.status).toBe('CANCELLED');
      expect(await refunds(commitmentId)).toHaveLength(1);
    });
  });
});
