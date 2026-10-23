import type {
  Commitment,
  CommitmentOptions,
  CreateCommitmentInput,
  Ledger,
  LeetCodeVerifyResult,
  PlanDetail,
  PlanSummary,
  ProgressResponse,
  TodayResponse,
} from '../types/commitment';
import { apiRequest } from './api';

const base = (id: string) => `/commitments/${id}`;

export const commitmentsService = {
  options: () => apiRequest<CommitmentOptions>('/commitments/options'),
  plans: () => apiRequest<PlanSummary[]>('/plans'),
  plan: (id: string) => apiRequest<PlanDetail>(`/plans/${id}`),
  list: () => apiRequest<Commitment[]>('/commitments'),
  create: (input: CreateCommitmentInput) =>
    apiRequest<Commitment>('/commitments', { method: 'POST', body: input }),
  devActivate: (id: string) =>
    apiRequest<Commitment>(`${base(id)}/dev-activate`, { method: 'POST' }),
  cancel: (id: string) => apiRequest<Commitment>(`${base(id)}/cancel`, { method: 'POST' }),
  today: (id: string) => apiRequest<TodayResponse>(`${base(id)}/today`),
  progress: (id: string) => apiRequest<ProgressResponse>(`${base(id)}/progress`),
  setProblem: (id: string, body: { problemId: string; completed: boolean }) =>
    apiRequest<TodayResponse>(`${base(id)}/daily-progress`, { method: 'POST', body }),
  completeDay: (id: string) =>
    apiRequest<TodayResponse>(`${base(id)}/daily-progress/complete`, { method: 'POST' }),
  verifyToday: (id: string) =>
    apiRequest<LeetCodeVerifyResult>(`${base(id)}/verify-today`, { method: 'POST' }),
  ledger: (id: string) => apiRequest<Ledger>(`${base(id)}/ledger`),
};
