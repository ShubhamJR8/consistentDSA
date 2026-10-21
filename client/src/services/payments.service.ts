import type { Commitment, PaymentOrder, VerifyPaymentInput } from '../types/commitment';
import { apiRequest } from './api';

export const paymentsService = {
  createOrder: (commitmentId: string) =>
    apiRequest<PaymentOrder>('/payments/create', { method: 'POST', body: { commitmentId } }),
  verify: (commitmentId: string, input: VerifyPaymentInput) =>
    apiRequest<Commitment>('/payments/verify', {
      method: 'POST',
      body: { commitmentId, ...input },
    }),
};
