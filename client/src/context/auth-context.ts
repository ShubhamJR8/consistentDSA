import { createContext } from 'react';
import type { User } from '../types/api';
import type { LoginInput, RegisterInput, ResetPasswordInput } from '../types/auth';

export const ME_KEY = ['auth', 'me'] as const;

export type AuthStatus = 'anonymous' | 'loading' | 'error' | 'authenticated';

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
  logout: () => void;
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
