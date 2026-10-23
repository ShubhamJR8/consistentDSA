import { env } from '../config/env.js';
import { Commitment, CommitmentStatus, ICommitment } from '../models/commitment.model.js';
import { ApiError } from '../utils/apiError.js';
import { addDays, dayKeyFor, hoursLeftInDay } from '../utils/localDate.js';
import { isObjectIdString } from '../utils/mongo.js';

/** The day Day 1 falls on if the commitment is activated at `now`: today, unless too little of today
 *  is left to be a fair day (see PAYMENT_MIN_START_HOURS), in which case tomorrow. */
export const resolveStartDate = (
  now: Date,
  timezone: string,
  minHours: number = env.PAYMENT_MIN_START_HOURS
): string => {
  const today = dayKeyFor(now, timezone);
  return hoursLeftInDay(now, timezone) < minHours ? addDays(today, 1) : today;
};

export interface CommitmentDto {
  id: string;
  planId: string;
  planName: string;
  status: CommitmentStatus;
  timezone: string;
  startDate: string | null;
  endDate: string | null;
  /** Only while awaiting payment: the day Day 1 would start if payment landed right now. */
  projectedStartDate: string | null;
  durationDays: number;
  dailyTarget: number;
  totalProblems: number;
  depositAmount: number;
  currentProtectedAmount: number;
  currentForfeitedAmount: number;
  currentStreak: number;
  longestStreak: number;
  completedDays: number;
  missedDays: number;
  rules: {
    forfeitureMode: 'percentage';
    forfeiturePerMissedDay: number;
    graceDays: number;
  };
  createdAt: Date;
}

export const toCommitmentDto = (commitment: ICommitment): CommitmentDto => ({
  id: commitment._id.toString(),
  planId: commitment.planId.toString(),
  planName: commitment.planName,
  status: commitment.status,
  timezone: commitment.timezone,
  startDate: commitment.startDate,
  endDate: commitment.endDate,
  projectedStartDate:
    commitment.status === 'PENDING_PAYMENT'
      ? resolveStartDate(new Date(), commitment.timezone)
      : null,
  durationDays: commitment.durationDays,
  dailyTarget: commitment.dailyTarget,
  totalProblems: commitment.totalProblems,
  depositAmount: commitment.depositAmount,
  currentProtectedAmount: commitment.currentProtectedAmount,
  currentForfeitedAmount: commitment.currentForfeitedAmount,
  currentStreak: commitment.currentStreak,
  longestStreak: commitment.longestStreak,
  completedDays: commitment.completedDays,
  missedDays: commitment.missedDays,
  rules: {
    forfeitureMode: commitment.rules.forfeitureMode,
    forfeiturePerMissedDay: commitment.rules.forfeiturePerMissedDay,
    graceDays: commitment.rules.graceDays,
  },
  createdAt: commitment.createdAt,
});

/** Loads a commitment only if it belongs to the user. Others get 404, never 403. */
export const getOwnedCommitment = async (
  userId: string,
  commitmentId: string
): Promise<ICommitment> => {
  const commitment = isObjectIdString(commitmentId)
    ? await Commitment.findOne({ _id: commitmentId, userId })
    : null;
  if (!commitment) throw ApiError.notFound('COMMITMENT_NOT_FOUND', 'Commitment not found');
  return commitment;
};

export const requireActive = (commitment: ICommitment): void => {
  if (commitment.status !== 'ACTIVE') {
    throw ApiError.conflict('COMMITMENT_NOT_ACTIVE', 'This commitment is not active.');
  }
};
