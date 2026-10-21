import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { submissionService } from '../services/submission.service';
import type { RunSubmissionInput } from '../types/submission';
import { queryKeys } from './useCommitments';

export const useJudgeProblem = (problemId: string) =>
  useQuery({
    queryKey: ['problems', problemId, 'judge'] as const,
    queryFn: () => submissionService.judgeDetail(problemId),
    staleTime: 5 * 60_000,
  });

export function useRunCode(commitmentId: string, problemId: string) {
  return useMutation({
    mutationFn: (input: RunSubmissionInput) =>
      submissionService.run(commitmentId, problemId, input),
  });
}

export function useSubmitCode(commitmentId: string, problemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RunSubmissionInput) =>
      submissionService.submit(commitmentId, problemId, input),
    onSuccess: (data) => {
      // An accepted submission checks the problem off server-side — refresh today/progress
      // so the dashboard and Today page pick up the new state without a manual toggle.
      if (data.markedComplete) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.today(commitmentId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.progress(commitmentId) });
      }
    },
  });
}
