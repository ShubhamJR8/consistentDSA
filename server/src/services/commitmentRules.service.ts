import type { ICommitmentRules } from '../models/commitment.model.js';

const OPTIONS = {
  dailyTargets: [1, 2, 3, 5],
  depositAmounts: [500, 1000, 2000, 5000],
  recommendedDailyTarget: 2,
} as const;

/**
 * The single source of truth for what a commitment may look like and which rules it is
 * created with. Rules are copied onto each commitment at creation, so changing the defaults
 * here never affects commitments that already exist.
 *
 * Duration is deliberately not one of these options — it isn't a pickable value. A commitment
 * always covers every problem in the chosen plan, so its length is `ceil(problemCount /
 * dailyTarget)`, computed fresh from whichever plan and pace the user actually picks
 * (CommitmentService.create). A fixed duration list would either not fit a plan's real problem
 * count or silently leave problems out of the commitment.
 */
export class CommitmentRules {
  static readonly options = OPTIONS;

  static defaultRules(): ICommitmentRules {
    return {
      forfeitureMode: 'percentage',
      forfeiturePerMissedDay: 10,
      graceDays: 0,
    };
  }
}
