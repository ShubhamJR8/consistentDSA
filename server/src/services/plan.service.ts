import { IPlan, Plan, PlanLevel } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { ApiError } from '../utils/apiError.js';
import { isObjectIdString } from '../utils/mongo.js';
import { ProblemDto, toProblemDto } from './problem.service.js';

export interface PlanSummaryDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  topic: string | null;
  level: PlanLevel | null;
  problemCount: number;
}

export interface PlanDetailDto extends PlanSummaryDto {
  problems: ProblemDto[];
}

const toPlanSummary = (plan: IPlan): PlanSummaryDto => ({
  id: plan._id.toString(),
  name: plan.name,
  slug: plan.slug,
  description: plan.description,
  topic: plan.topic,
  level: plan.level,
  problemCount: plan.problemIds.length,
});

export class PlanService {
  static async list(): Promise<PlanSummaryDto[]> {
    const plans = await Plan.find({ active: true }).sort({ order: 1 });
    return plans.map(toPlanSummary);
  }

  static async getById(id: string): Promise<PlanDetailDto> {
    const plan = isObjectIdString(id) ? await Plan.findOne({ _id: id, active: true }) : null;
    if (!plan) throw ApiError.notFound('PLAN_NOT_FOUND', 'Plan not found');

    const problems = await Problem.find({ _id: { $in: plan.problemIds } });
    const byId = new Map(problems.map((p) => [p._id.toString(), p]));
    const ordered = plan.problemIds
      .map((problemId) => byId.get(problemId.toString()))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map(toProblemDto);

    return { ...toPlanSummary(plan), problems: ordered };
  }
}
