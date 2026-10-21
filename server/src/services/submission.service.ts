import { Types } from 'mongoose';
import { IDailyProgress } from '../models/dailyProgress.model.js';
import { IProblem, Problem } from '../models/problem.model.js';
import { Submission, SubmissionStatus } from '../models/submission.model.js';
import { ApiError } from '../utils/apiError.js';
import { isObjectIdString } from '../utils/mongo.js';
import { DailyProgressService } from './dailyProgress.service.js';
import { Judge0TestOutcome, runBatch } from './judge0.service.js';

export interface RunResultDto {
  results: {
    index: number;
    passed: boolean;
    input: string;
    expectedOutput: string;
    actualOutput: string;
    stderr: string | null;
  }[];
  allPassed: boolean;
}

export interface SubmitResultItemDto {
  index: number;
  isSample: boolean;
  passed: boolean;
  // Hidden-test actual/expected output is deliberately withheld — only pass/fail is returned,
  // so a submission can't be used to fish out the answers to cases that weren't shown up front.
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  stderr?: string | null;
}

export interface SubmitResultDto {
  id: string;
  status: SubmissionStatus;
  passedCount: number;
  totalCount: number;
  results: SubmitResultItemDto[];
  markedComplete: boolean;
}

const loadJudgeProblem = async (problemId: string): Promise<IProblem> => {
  const problem = isObjectIdString(problemId)
    ? await Problem.findOne({ _id: problemId, active: true, judgeEnabled: true })
    : null;
  if (!problem) {
    throw ApiError.notFound(
      'JUDGE_PROBLEM_NOT_FOUND',
      "This problem doesn't have an in-editor judge yet."
    );
  }
  return problem;
};

const assertAssignedToday = (progress: IDailyProgress, problemId: Types.ObjectId): void => {
  if (!progress.problemIds.some((id) => id.equals(problemId))) {
    throw ApiError.badRequest(
      'PROBLEM_NOT_ASSIGNED',
      "That problem isn't part of today's commitment."
    );
  }
};

const deriveStatus = (outcomes: Judge0TestOutcome[]): SubmissionStatus => {
  if (outcomes.some((o) => o.status === 'COMPILE_ERROR')) return 'COMPILE_ERROR';
  if (outcomes.every((o) => o.passed)) return 'ACCEPTED';
  if (outcomes.some((o) => o.status === 'TIME_LIMIT_EXCEEDED')) return 'TIME_LIMIT_EXCEEDED';
  if (outcomes.some((o) => o.status === 'RUNTIME_ERROR')) return 'RUNTIME_ERROR';
  if (outcomes.some((o) => o.status === 'JUDGE_ERROR')) return 'JUDGE_ERROR';
  return 'WRONG_ANSWER';
};

export class SubmissionService {
  /** Runs the sample test cases only, against a live day's assigned problem. Nothing is
   *  persisted — this is a scratchpad check before spending a real "Submit". */
  static async run(
    userId: string,
    commitmentId: string,
    problemId: string,
    input: { language: string; code: string },
    now: Date = new Date()
  ): Promise<RunResultDto> {
    const problem = await loadJudgeProblem(problemId);
    const { progress } = await DailyProgressService.loadDayForWrite(userId, commitmentId, now);
    assertAssignedToday(progress, problem._id);

    const samples = (problem.testCases ?? []).filter((t) => t.isSample);
    if (samples.length === 0) {
      throw ApiError.internal('NO_SAMPLE_TESTS', 'This problem has no sample tests configured.');
    }

    const outcomes = await runBatch({
      language: input.language,
      code: input.code,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      tests: samples.map((t) => ({ stdin: t.input, expectedOutput: t.expectedOutput })),
    });

    const results = outcomes.map((outcome, index) => ({
      index,
      passed: outcome.passed,
      input: samples[index].input,
      expectedOutput: samples[index].expectedOutput,
      actualOutput: outcome.stdout,
      stderr: outcome.stderr,
    }));

    return { results, allPassed: results.every((r) => r.passed) };
  }

  /** Runs every test case (sample + hidden), persists a Submission for the audit trail, and on
   *  a full pass marks the problem complete for today — the only path to checking it off. */
  static async submit(
    userId: string,
    commitmentId: string,
    problemId: string,
    input: { language: string; code: string },
    now: Date = new Date()
  ): Promise<SubmitResultDto> {
    const problem = await loadJudgeProblem(problemId);
    const { progress } = await DailyProgressService.loadDayForWrite(userId, commitmentId, now);
    assertAssignedToday(progress, problem._id);

    if (progress.status !== 'PENDING') {
      throw ApiError.conflict('DAY_ALREADY_COMPLETED', "Today's commitment is already complete.");
    }

    const tests = problem.testCases ?? [];
    if (tests.length === 0) {
      throw ApiError.internal('NO_TESTS', 'This problem has no tests configured.');
    }

    const outcomes = await runBatch({
      language: input.language,
      code: input.code,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      tests: tests.map((t) => ({ stdin: t.input, expectedOutput: t.expectedOutput })),
    });

    const passedCount = outcomes.filter((o) => o.passed).length;
    const status = deriveStatus(outcomes);

    const submission = await Submission.create({
      userId,
      commitmentId,
      problemId: problem._id,
      language: input.language,
      code: input.code,
      status,
      passedCount,
      totalCount: tests.length,
      results: outcomes.map((o, index) => ({
        index,
        passed: o.passed,
        isSample: tests[index].isSample,
        stdout: o.stdout,
        stderr: o.stderr ?? undefined,
        timeMs: o.timeMs ?? undefined,
      })),
      submittedAt: now,
      judgedAt: now,
    });

    let markedComplete = false;
    if (status === 'ACCEPTED') {
      await DailyProgressService.recordJudgeCompletion(progress._id, problem._id, submission._id, now);
      markedComplete = true;
    }

    return {
      id: submission._id.toString(),
      status,
      passedCount,
      totalCount: tests.length,
      results: outcomes.map((outcome, index) => {
        const test = tests[index];
        return {
          index,
          isSample: test.isSample,
          passed: outcome.passed,
          ...(test.isSample && {
            input: test.input,
            expectedOutput: test.expectedOutput,
            actualOutput: outcome.stdout,
            stderr: outcome.stderr,
          }),
        };
      }),
      markedComplete,
    };
  }
}
