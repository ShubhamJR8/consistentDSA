import type {
  JudgeProblemDetail,
  RunResult,
  RunSubmissionInput,
  SubmitResult,
} from '../types/submission';
import { apiRequest } from './api';

export const submissionService = {
  judgeDetail: (problemId: string) => apiRequest<JudgeProblemDetail>(`/problems/${problemId}/judge`),
  run: (commitmentId: string, problemId: string, body: RunSubmissionInput) =>
    apiRequest<RunResult>(`/commitments/${commitmentId}/today/problems/${problemId}/run`, {
      method: 'POST',
      body,
    }),
  submit: (commitmentId: string, problemId: string, body: RunSubmissionInput) =>
    apiRequest<SubmitResult>(`/commitments/${commitmentId}/today/problems/${problemId}/submit`, {
      method: 'POST',
      body,
    }),
};
