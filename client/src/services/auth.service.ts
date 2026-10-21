import type { AuthResult, User } from '../types/api';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '../types/auth';
import { apiRequest } from './api';

export const authService = {
  register: (input: RegisterInput & { timezone: string }) =>
    apiRequest<AuthResult>('/auth/register', { method: 'POST', body: input }),

  login: (input: LoginInput) => apiRequest<AuthResult>('/auth/login', { method: 'POST', body: input }),

  me: () => apiRequest<User>('/auth/me'),

  logout: () => apiRequest<{ message: string }>('/auth/logout', { method: 'POST' }),

  forgotPassword: (input: ForgotPasswordInput) =>
    apiRequest<{ message: string }>('/auth/forgot-password', { method: 'POST', body: input }),

  resetPassword: (input: ResetPasswordInput) =>
    apiRequest<AuthResult>('/auth/reset-password', { method: 'POST', body: input }),

  verifyEmail: (input: VerifyEmailInput) =>
    apiRequest<User>('/auth/verify-email', { method: 'POST', body: input }),

  resendVerification: () =>
    apiRequest<{ message: string }>('/auth/resend-verification', { method: 'POST' }),
};
