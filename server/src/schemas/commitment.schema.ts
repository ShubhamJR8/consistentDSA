import { z } from 'zod';
import { CommitmentRules } from '../services/commitmentRules.service.js';
import { OBJECT_ID_PATTERN } from '../utils/mongo.js';

const oneOf = (allowed: readonly number[], label: string) =>
  z
    .number({
      invalid_type_error: `${label} must be a number`,
      required_error: `${label} is required`,
    })
    .int()
    .refine((value) => allowed.includes(value), `Unsupported ${label}`);

const objectId = (label: string) => z.string().regex(OBJECT_ID_PATTERN, `Invalid ${label}`);

// Money and pace values are validated against the server's allow-lists. Duration isn't client
// input at all — CommitmentService.create derives it from the chosen plan's problem count and
// dailyTarget, so there's nothing here to validate it against.
export const createCommitmentSchema = z.object({
  planId: objectId('plan id'),
  dailyTarget: oneOf(CommitmentRules.options.dailyTargets, 'daily target'),
  depositAmount: oneOf(CommitmentRules.options.depositAmounts, 'deposit amount'),
});

export const recordProblemSchema = z.object({
  problemId: objectId('problem id'),
  completed: z.boolean(),
});

export type CreateCommitmentInput = z.infer<typeof createCommitmentSchema>;
export type RecordProblemInput = z.infer<typeof recordProblemSchema>;
