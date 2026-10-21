import { PlanService } from '../services/plan.service.js';
import { ProblemService } from '../services/problem.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

// Query params can arrive as arrays or objects; only plain strings are used as filters.
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export class ProblemController {
  static list = asyncHandler(async (req, res) => {
    const problems = await ProblemService.list({
      topic: asString(req.query.topic),
      difficulty: asString(req.query.difficulty),
    });
    sendSuccess(res, problems);
  });

  static getById = asyncHandler(async (req, res) => {
    sendSuccess(res, await ProblemService.getById(req.params.id));
  });

  static judgeDetail = asyncHandler(async (req, res) => {
    sendSuccess(res, await ProblemService.getJudgeDetail(req.params.id));
  });
}

export class PlanController {
  static list = asyncHandler(async (_req, res) => {
    sendSuccess(res, await PlanService.list());
  });

  static getById = asyncHandler(async (req, res) => {
    sendSuccess(res, await PlanService.getById(req.params.id));
  });
}
