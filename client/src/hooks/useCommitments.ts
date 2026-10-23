import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commitmentsService } from '../services/commitments.service';
import { paymentsService } from '../services/payments.service';
import type { VerifyPaymentInput } from '../types/commitment';

export const queryKeys = {
  options: ['commitment-options'] as const,
  plans: ['plans'] as const,
  plan: (id: string) => ['plans', id] as const,
  commitments: ['commitments'] as const,
  today: (id: string) => ['commitments', id, 'today'] as const,
  progress: (id: string) => ['commitments', id, 'progress'] as const,
  ledger: (id: string) => ['commitments', id, 'ledger'] as const,
};

export const useCommitmentOptions = () =>
  useQuery({
    queryKey: queryKeys.options,
    queryFn: commitmentsService.options,
    staleTime: Infinity,
  });

export const usePlans = () =>
  useQuery({ queryKey: queryKeys.plans, queryFn: commitmentsService.plans, staleTime: 5 * 60_000 });

export const usePlan = (id: string | null) =>
  useQuery({
    queryKey: queryKeys.plan(id ?? ''),
    queryFn: () => commitmentsService.plan(id as string),
    enabled: id !== null,
    staleTime: 5 * 60_000,
  });

// While a commitment is awaiting payment, keep checking: the payment may have been confirmed by the
// server (webhook / reconciliation) after the checkout tab was closed or the callback never arrived.
const PENDING_PAYMENT_POLL_MS = 5000;

export const useCommitments = () =>
  useQuery({
    queryKey: queryKeys.commitments,
    queryFn: commitmentsService.list,
    refetchInterval: (query) =>
      query.state.data?.some((commitment) => commitment.status === 'PENDING_PAYMENT')
        ? PENDING_PAYMENT_POLL_MS
        : false,
  });

export function useCancelCommitment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => commitmentsService.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.commitments }),
  });
}

export const useToday = (id: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.today(id),
    queryFn: () => commitmentsService.today(id),
    enabled,
  });

export const useProgress = (id: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.progress(id),
    queryFn: () => commitmentsService.progress(id),
    enabled,
  });

export const useLedger = (id: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.ledger(id),
    queryFn: () => commitmentsService.ledger(id),
    enabled,
  });

export function useCreateCommitment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: commitmentsService.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.commitments }),
  });
}

export function useDevActivate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: commitmentsService.devActivate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.commitments }),
  });
}

export function useSetProblemCompletion(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { problemId: string; completed: boolean }) =>
      commitmentsService.setProblem(id, input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.today(id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.progress(id) });
    },
  });
}

export function useCompleteDay(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => commitmentsService.completeDay(id),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.today(id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.progress(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.commitments });
    },
  });
}

export function useCreatePaymentOrder() {
  return useMutation({ mutationFn: paymentsService.createOrder });
}

export function useVerifyPayment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: VerifyPaymentInput) => paymentsService.verify(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.commitments }),
  });
}

export function useVerifyToday(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => commitmentsService.verifyToday(id),
    onSuccess: (result) => {
      // The endpoint only reports which problems it checked — refetch today's actual state
      // rather than guessing at it, since a verified problem can also complete the whole day.
      if (result.verifiedProblemIds.length > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.today(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.progress(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.commitments });
      }
    },
  });
}
