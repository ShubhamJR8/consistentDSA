import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../integrations/razorpay/razorpay.client.js', () => ({
  isRazorpayConfigured: vi.fn(),
  razorpayClient: {
    createOrder: vi.fn(),
    verifyCheckoutSignature: vi.fn(),
  },
}));

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { Commitment } from '../models/commitment.model.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { Plan } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { isRazorpayConfigured, razorpayClient } from '../integrations/razorpay/razorpay.client.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const mockIsConfigured = vi.mocked(isRazorpayConfigured);
const mockCreateOrder = vi.mocked(razorpayClient.createOrder);
const mockVerifySignature = vi.mocked(razorpayClient.verifyCheckoutSignature);

const TEST_DB = 'commit_dsa_test_payments';

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

describe('Payments (Razorpay test mode)', () => {
  const app = createApp();
  let planId: string;

  const register = async (label: string): Promise<TestUser> => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: `Payment ${label}`,
        email: `payment-test-${label}-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(res.status).toBe(201);
    // Deposits require a verified email (see payment.service.ts) — these tests are about the
    // payment flow itself, not verification, so mark it verified up front unless a test opts out.
    await User.updateOne({ _id: res.body.data.user.id }, { $set: { emailVerified: true } });
    return { id: res.body.data.user.id, cookie: extractAuthCookie(res) };
  };

  const auth = (user: TestUser) => ({ Cookie: user.cookie });

  /** Creates a fresh PENDING_PAYMENT commitment for a new user, ready for the payment flow. */
  const createPendingCommitment = async (label: string) => {
    const user = await register(label);
    const res = await request(app)
      .post('/api/commitments')
      .set(auth(user))
      .send({ planId, dailyTarget: 3, depositAmount: 1000 });
    expect(res.status).toBe(201);
    return { user, commitmentId: res.body.data.id as string };
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
      Array.from({ length: 21 }, (_, i) => ({
        title: `Payment Problem ${i + 1}`,
        slug: `pay-problem-${i + 1}`,
        difficulty: 'Easy',
        topic: 'Test',
        url: `https://example.com/pay-problems/${i + 1}`,
        source: 'Test',
        order: i + 1,
      }))
    );
    const plan = await Plan.create({
      name: 'Payment Test Plan',
      slug: 'pay-test-plan',
      description: 'Plan for payment tests',
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

  describe('POST /api/payments/create', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/payments/create').send({ commitmentId: planId });
      expect(res.status).toBe(401);
    });

    it('fails clearly when Razorpay is not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      const { user, commitmentId } = await createPendingCommitment('unconfigured');

      const res = await request(app)
        .post('/api/payments/create')
        .set(auth(user))
        .send({ commitmentId });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('PAYMENTS_NOT_CONFIGURED');
      expect(mockCreateOrder).not.toHaveBeenCalled();
    });

    it('creates a Razorpay order and a matching PENDING deposit transaction', async () => {
      mockCreateOrder.mockResolvedValueOnce({
        id: 'order_abc123',
        amount: 100000,
        currency: 'INR',
        status: 'created',
      });
      const { user, commitmentId } = await createPendingCommitment('create');

      const res = await request(app)
        .post('/api/payments/create')
        .set(auth(user))
        .send({ commitmentId });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        orderId: 'order_abc123',
        amount: 100000,
        currency: 'INR',
      });
      expect(res.body.data.keyId).toBe(env.RAZORPAY_KEY_ID ?? undefined);

      const tx = await CommitmentTransaction.findOne({ commitmentId });
      expect(tx?.type).toBe('DEPOSIT');
      expect(tx?.status).toBe('PENDING');
      expect(tx?.amount).toBe(1000);
      expect(tx?.razorpayOrderId).toBe('order_abc123');
    });

    it('reuses the existing pending order on a retry instead of minting a new one', async () => {
      mockCreateOrder.mockResolvedValueOnce({
        id: 'order_retry1',
        amount: 100000,
        currency: 'INR',
        status: 'created',
      });
      const { user, commitmentId } = await createPendingCommitment('retry');

      const first = await request(app)
        .post('/api/payments/create')
        .set(auth(user))
        .send({ commitmentId });
      expect(first.body.data.orderId).toBe('order_retry1');

      const second = await request(app)
        .post('/api/payments/create')
        .set(auth(user))
        .send({ commitmentId });
      expect(second.status).toBe(201);
      expect(second.body.data.orderId).toBe('order_retry1');
      expect(mockCreateOrder).toHaveBeenCalledTimes(1);

      const count = await CommitmentTransaction.countDocuments({ commitmentId });
      expect(count).toBe(1);
    });

    it('refuses to create an order for a user with an unverified email', async () => {
      const { user, commitmentId } = await createPendingCommitment('unverified');
      await User.updateOne({ _id: user.id }, { $set: { emailVerified: false } });

      const res = await request(app)
        .post('/api/payments/create')
        .set(auth(user))
        .send({ commitmentId });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect(mockCreateOrder).not.toHaveBeenCalled();
    });

    it('refuses to create an order for a commitment that is not awaiting payment', async () => {
      mockCreateOrder.mockResolvedValueOnce({
        id: 'order_active',
        amount: 100000,
        currency: 'INR',
        status: 'created',
      });
      const { user, commitmentId } = await createPendingCommitment('not-pending');
      // Dev-activate it directly so it is no longer PENDING_PAYMENT.
      await Commitment.updateOne({ _id: commitmentId }, { $set: { status: 'ACTIVE' } });

      const res = await request(app)
        .post('/api/payments/create')
        .set(auth(user))
        .send({ commitmentId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COMMITMENT_NOT_PENDING_PAYMENT');
    });
  });

  describe('POST /api/payments/verify', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/payments/verify').send({
        commitmentId: planId,
        razorpayOrderId: 'x',
        razorpayPaymentId: 'y',
        razorpaySignature: 'z',
      });
      expect(res.status).toBe(401);
    });

    it('activates the commitment once the signature checks out', async () => {
      mockCreateOrder.mockResolvedValueOnce({
        id: 'order_verify_ok',
        amount: 100000,
        currency: 'INR',
        status: 'created',
      });
      const { user, commitmentId } = await createPendingCommitment('verify-ok');
      await request(app).post('/api/payments/create').set(auth(user)).send({ commitmentId });

      mockVerifySignature.mockReturnValueOnce(true);
      const res = await request(app).post('/api/payments/verify').set(auth(user)).send({
        commitmentId,
        razorpayOrderId: 'order_verify_ok',
        razorpayPaymentId: 'pay_verify_ok',
        razorpaySignature: 'valid-signature',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.startDate).not.toBeNull();

      const tx = await CommitmentTransaction.findOne({ commitmentId, type: 'DEPOSIT' });
      expect(tx?.status).toBe('SUCCESS');
      expect(tx?.razorpayPaymentId).toBe('pay_verify_ok');
    });

    it('never trusts the frontend: a bad signature fails the payment and leaves it PENDING_PAYMENT', async () => {
      mockCreateOrder.mockResolvedValueOnce({
        id: 'order_bad_sig',
        amount: 100000,
        currency: 'INR',
        status: 'created',
      });
      const { user, commitmentId } = await createPendingCommitment('verify-bad-sig');
      await request(app).post('/api/payments/create').set(auth(user)).send({ commitmentId });

      mockVerifySignature.mockReturnValueOnce(false);
      const res = await request(app).post('/api/payments/verify').set(auth(user)).send({
        commitmentId,
        razorpayOrderId: 'order_bad_sig',
        razorpayPaymentId: 'pay_bad_sig',
        razorpaySignature: 'forged-signature',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');

      const tx = await CommitmentTransaction.findOne({ commitmentId, type: 'DEPOSIT' });
      expect(tx?.status).toBe('FAILED');

      const commitment = await Commitment.findById(commitmentId);
      expect(commitment?.status).toBe('PENDING_PAYMENT');
    });

    it('is idempotent — a duplicate verify call on an already-ACTIVE commitment just returns it', async () => {
      mockCreateOrder.mockResolvedValueOnce({
        id: 'order_dup',
        amount: 100000,
        currency: 'INR',
        status: 'created',
      });
      const { user, commitmentId } = await createPendingCommitment('verify-dup');
      await request(app).post('/api/payments/create').set(auth(user)).send({ commitmentId });

      mockVerifySignature.mockReturnValue(true);
      const body = {
        commitmentId,
        razorpayOrderId: 'order_dup',
        razorpayPaymentId: 'pay_dup',
        razorpaySignature: 'valid-signature',
      };
      const first = await request(app).post('/api/payments/verify').set(auth(user)).send(body);
      expect(first.status).toBe(200);
      expect(first.body.data.status).toBe('ACTIVE');

      const second = await request(app).post('/api/payments/verify').set(auth(user)).send(body);
      expect(second.status).toBe(200);
      expect(second.body.data.status).toBe('ACTIVE');
      expect(second.body.data.startDate).toBe(first.body.data.startDate);
    });

    it('404s when the order does not belong to this commitment', async () => {
      const { user, commitmentId } = await createPendingCommitment('verify-unknown-order');

      const res = await request(app).post('/api/payments/verify').set(auth(user)).send({
        commitmentId,
        razorpayOrderId: 'order_never_created',
        razorpayPaymentId: 'pay_x',
        razorpaySignature: 'sig_x',
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
    });
  });
});
