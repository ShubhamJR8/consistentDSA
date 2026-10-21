import type { Commitment, CommitmentOptions, TodayDetails } from '../types/commitment';

export const findOpenCommitment = (commitments: Commitment[]): Commitment | undefined =>
  commitments.find((c) => c.status === 'ACTIVE' || c.status === 'PENDING_PAYMENT');

export interface PaceSuggestion {
  durationDays: number;
  dailyTarget: number;
  totalProblems: number;
}

/**
 * Suggests a default daily pace for a challenge card, so it can show real pacing instead of a
 * vague "150 problems". Duration is never picked from a list — a commitment always covers every
 * problem in the plan, so it's always however many days that takes at the chosen daily target,
 * rounded up. This just picks which daily target to lead with (the platform's recommended one),
 * anchoring the number shown before the user opens the wizard and can change it. Returns null
 * only for a plan with no problems at all, which can't support a commitment.
 */
export function suggestPace(
  problemCount: number,
  options: CommitmentOptions
): PaceSuggestion | null {
  if (problemCount <= 0 || options.dailyTargets.length === 0) return null;
  const dailyTarget = options.dailyTargets.includes(options.recommendedDailyTarget)
    ? options.recommendedDailyTarget
    : options.dailyTargets[0];
  return {
    dailyTarget,
    durationDays: Math.ceil(problemCount / dailyTarget),
    totalProblems: problemCount,
  };
}

/** Encouraging, never shaming: describes what is left rather than what was missed. */
export const todayMessage = (today: TodayDetails): string => {
  if (today.status === 'COMPLETED') return "You're done for today. Come back tomorrow.";
  const remaining = today.requiredProblems - today.completedProblems;
  if (remaining <= 0) return 'All problems checked. Confirm to lock in today.';
  if (today.completedProblems === 0) return 'Your commitment is waiting.';
  if (remaining === 1) return "You're one problem away from completing today.";
  return `${today.completedProblems} of ${today.requiredProblems} problems completed.`;
};
