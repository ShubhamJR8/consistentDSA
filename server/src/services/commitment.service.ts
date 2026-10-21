import { env } from '../config/env.js';
import { Commitment, ICommitment, OPEN_STATUSES } from '../models/commitment.model.js';
import {
  CommitmentTransaction,
  ICommitmentTransaction,
} from '../models/commitmentTransaction.model.js';
import { Plan } from '../models/plan.model.js';
import { User } from '../models/user.model.js';
import { CreateCommitmentInput } from '../schemas/commitment.schema.js';
import { ApiError } from '../utils/apiError.js';
import { addDays, dayKeyFor, resolveTimezone } from '../utils/localDate.js';
import { isDuplicateKeyError } from '../utils/mongo.js';
import { CommitmentDto, getOwnedCommitment, toCommitmentDto } from './commitment.shared.js';
import { CommitmentRules } from './commitmentRules.service.js';
import { DailyProgressService } from './dailyProgress.service.js';

export interface LedgerTransactionDto {
  id: string;
  type: ICommitmentTransaction['type'];
  amount: number;
  status: ICommitmentTransaction['status'];
  reference: string;
  createdAt: Date;
}

export interface LedgerDto {
  commitment: CommitmentDto;
  transactions: LedgerTransactionDto[];
}

const toLedgerTransactionDto = (tx: ICommitmentTransaction): LedgerTransactionDto => ({
  id: tx._id.toString(),
  type: tx.type,
  amount: tx.amount,
  status: tx.status,
  reference: tx.reference,
  createdAt: tx.createdAt,
});

export interface CommitmentOptionsDto {
  dailyTargets: number[];
  depositAmounts: number[];
  recommendedDailyTarget: number;
  rules: ReturnType<typeof CommitmentRules.defaultRules>;
}

const openCommitmentExists = () =>
  ApiError.conflict(
    'OPEN_COMMITMENT_EXISTS',
    'You already have an open commitment. Finish it before starting another.'
  );

export class CommitmentService {
  static getOptions(): CommitmentOptionsDto {
    const { dailyTargets, depositAmounts, recommendedDailyTarget } = CommitmentRules.options;
    return {
      dailyTargets: [...dailyTargets],
      depositAmounts: [...depositAmounts],
      recommendedDailyTarget,
      rules: CommitmentRules.defaultRules(),
    };
  }

  static async create(userId: string, input: CreateCommitmentInput): Promise<CommitmentDto> {
    const [user, plan] = await Promise.all([
      User.findById(userId),
      Plan.findOne({ _id: input.planId, active: true }),
    ]);
    if (!user) throw ApiError.unauthorized('USER_NOT_FOUND', 'Account no longer exists');
    if (!plan) throw ApiError.notFound('PLAN_NOT_FOUND', 'Plan not found');

    const totalProblems = plan.problemIds.length;
    if (totalProblems === 0) {
      throw ApiError.badRequest('PLAN_EMPTY', 'This plan has no problems yet.');
    }

    // A commitment always covers every problem in the plan; duration is never a separate choice,
    // it's just how many days that takes at the chosen daily pace, rounded up so the last day
    // gets whatever's left over instead of silently dropping problems off the end.
    const durationDays = Math.ceil(totalProblems / input.dailyTarget);

    if (await Commitment.exists({ userId, status: { $in: [...OPEN_STATUSES] } })) {
      throw openCommitmentExists();
    }

    try {
      const commitment = await Commitment.create({
        userId: user._id,
        planId: plan._id,
        planName: plan.name,
        timezone: resolveTimezone(user.timezone),
        durationDays,
        dailyTarget: input.dailyTarget,
        totalProblems,
        depositAmount: input.depositAmount,
        status: 'PENDING_PAYMENT',
        rules: CommitmentRules.defaultRules(),
      });
      return toCommitmentDto(commitment);
    } catch (error) {
      if (isDuplicateKeyError(error)) throw openCommitmentExists();
      throw error;
    }
  }

  static async list(userId: string, now: Date = new Date()): Promise<CommitmentDto[]> {
    const commitments = await Commitment.find({ userId }).sort({ createdAt: -1 });
    for (const commitment of commitments) {
      await DailyProgressService.reconcile(commitment, now);
    }
    return commitments.map(toCommitmentDto);
  }

  static async getById(
    userId: string,
    commitmentId: string,
    now: Date = new Date()
  ): Promise<CommitmentDto> {
    const commitment = await getOwnedCommitment(userId, commitmentId);
    await DailyProgressService.reconcile(commitment, now);
    return toCommitmentDto(commitment);
  }

  static async getLedger(
    userId: string,
    commitmentId: string,
    now: Date = new Date()
  ): Promise<LedgerDto> {
    const commitment = await getOwnedCommitment(userId, commitmentId);
    await DailyProgressService.reconcile(commitment, now);
    const transactions = await CommitmentTransaction.find({ commitmentId: commitment._id }).sort({
      createdAt: 1,
    });
    return {
      commitment: toCommitmentDto(commitment),
      transactions: transactions.map(toLedgerTransactionDto),
    };
  }

  /**
   * Shared activation path for a commitment sitting in PENDING_PAYMENT: materializes its daily
   * progress rows starting today (the local day payment/dev-activation lands on), then atomically
   * flips it to ACTIVE. Callers (dev bypass, real payment verification) are responsible for
   * checking why activation is allowed.
   */
  private static async activate(commitment: ICommitment, now: Date): Promise<CommitmentDto> {
    const plan = await Plan.findById(commitment.planId);
    if (!plan) throw ApiError.notFound('PLAN_NOT_FOUND', 'Plan not found');
    if (commitment.totalProblems > plan.problemIds.length) {
      throw ApiError.badRequest('PLAN_TOO_SMALL', 'This plan no longer has enough problems.');
    }

    const startDate = dayKeyFor(now, commitment.timezone);
    const endDate = addDays(startDate, commitment.durationDays - 1);

    await DailyProgressService.materialize(commitment, startDate, plan.problemIds);

    const activated = await Commitment.findOneAndUpdate(
      { _id: commitment._id, status: 'PENDING_PAYMENT' },
      { $set: { status: 'ACTIVE', startDate, endDate } },
      { new: true }
    );
    if (!activated) {
      throw ApiError.conflict(
        'COMMITMENT_NOT_PENDING_PAYMENT',
        'Only a commitment awaiting payment can be activated.'
      );
    }
    return toCommitmentDto(activated);
  }

  /**
   * Dev-only bypass for activation, kept behind the NODE_ENV guard so local testing doesn't
   * require real Razorpay keys. The real flow is PaymentService.verifyPayment -> activateAfterPayment.
   */
  static async activateForDev(
    userId: string,
    commitmentId: string,
    now: Date = new Date()
  ): Promise<CommitmentDto> {
    if (env.NODE_ENV === 'production') {
      throw ApiError.forbidden('DEV_ONLY', 'Manual activation is not available in production');
    }

    const commitment = await getOwnedCommitment(userId, commitmentId);
    if (commitment.status !== 'PENDING_PAYMENT') {
      throw ApiError.conflict(
        'COMMITMENT_NOT_PENDING_PAYMENT',
        'Only a commitment awaiting payment can be activated.'
      );
    }
    return this.activate(commitment, now);
  }

  /**
   * Called only after PaymentService has verified a Razorpay signature. Idempotent: a retried
   * verify call on an already-ACTIVE commitment just returns its current state instead of erroring,
   * since payment webhooks/checkout callbacks can legitimately fire more than once.
   */
  static async activateAfterPayment(
    commitment: ICommitment,
    now: Date = new Date()
  ): Promise<CommitmentDto> {
    if (commitment.status === 'ACTIVE') {
      return toCommitmentDto(commitment);
    }
    if (commitment.status !== 'PENDING_PAYMENT') {
      throw ApiError.conflict(
        'COMMITMENT_NOT_PENDING_PAYMENT',
        'Only a commitment awaiting payment can be activated.'
      );
    }
    return this.activate(commitment, now);
  }
}
