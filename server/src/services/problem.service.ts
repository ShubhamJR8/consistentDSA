import type { FilterQuery } from 'mongoose';
import { DIFFICULTIES, IProblem, Problem } from '../models/problem.model.js';
import { ApiError } from '../utils/apiError.js';
import { isObjectIdString } from '../utils/mongo.js';

export interface ProblemDto {
  id: string;
  title: string;
  slug: string;
  difficulty: IProblem['difficulty'];
  topic: string;
  url: string;
  source: string;
  order: number;
  /** Whether this problem can be solved in-editor with automatic, Judge0-verified completion. */
  judgeEnabled: boolean;
}

export interface ProblemJudgeDetailDto extends ProblemDto {
  statement: string;
  constraints: string[];
  examples: { input: string; output: string; explanation?: string }[];
  starterCode: { language: string; code: string }[];
  // Hidden test cases are never sent to the client — only the samples shown on the problem page.
  sampleTests: { input: string; expectedOutput: string }[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

export const toProblemDto = (problem: IProblem): ProblemDto => ({
  id: problem._id.toString(),
  title: problem.title,
  slug: problem.slug,
  difficulty: problem.difficulty,
  topic: problem.topic,
  url: problem.url,
  source: problem.source,
  order: problem.order,
  judgeEnabled: problem.judgeEnabled,
});

export class ProblemService {
  static async list(filters: { topic?: string; difficulty?: string }): Promise<ProblemDto[]> {
    const query: FilterQuery<IProblem> = { active: true };
    if (filters.topic) query.topic = filters.topic;
    if (filters.difficulty) {
      if (!(DIFFICULTIES as readonly string[]).includes(filters.difficulty)) return [];
      query.difficulty = filters.difficulty;
    }
    const problems = await Problem.find(query).sort({ order: 1 });
    return problems.map(toProblemDto);
  }

  static async getById(id: string): Promise<ProblemDto> {
    const problem = isObjectIdString(id) ? await Problem.findOne({ _id: id, active: true }) : null;
    if (!problem) throw ApiError.notFound('PROBLEM_NOT_FOUND', 'Problem not found');
    return toProblemDto(problem);
  }

  static async getJudgeDetail(id: string): Promise<ProblemJudgeDetailDto> {
    const problem = isObjectIdString(id)
      ? await Problem.findOne({ _id: id, active: true, judgeEnabled: true })
      : null;
    if (!problem) {
      throw ApiError.notFound(
        'JUDGE_PROBLEM_NOT_FOUND',
        "This problem doesn't have an in-editor judge yet."
      );
    }
    return {
      ...toProblemDto(problem),
      statement: problem.statement ?? '',
      constraints: problem.constraints ?? [],
      examples: problem.examples ?? [],
      starterCode: problem.starterCode ?? [],
      sampleTests: (problem.testCases ?? [])
        .filter((t) => t.isSample)
        .map((t) => ({ input: t.input, expectedOutput: t.expectedOutput })),
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    };
  }
}
