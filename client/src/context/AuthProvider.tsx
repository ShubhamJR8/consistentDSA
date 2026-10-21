import { useCallback, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../services/api';
import { authService } from '../services/auth.service';
import type { AuthResult } from '../types/api';
import type { LoginInput, RegisterInput, ResetPasswordInput } from '../types/auth';
import { AuthContext, ME_KEY, type AuthContextValue, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Auth now lives entirely in an httpOnly cookie the browser sends automatically — there's no
  // client-side token to gate this on, so we always ask the server whether a valid session cookie
  // is attached. A 401 here just means "not logged in", not an error.
  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: authService.me,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const logout = useCallback(() => {
    queryClient.clear();
    void authService.logout();
  }, [queryClient]);

  const startSession = useCallback(
    ({ user }: AuthResult) => {
      queryClient.setQueryData(ME_KEY, user);
    },
    [queryClient]
  );

  const login = useCallback(
    async (input: LoginInput) => startSession(await authService.login(input)),
    [startSession]
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      startSession(await authService.register({ ...input, timezone }));
    },
    [startSession]
  );

  const resetPassword = useCallback(
    async (input: ResetPasswordInput) => startSession(await authService.resetPassword(input)),
    [startSession]
  );

  const retry = useCallback(() => {
    void meQuery.refetch();
  }, [meQuery]);

  const unauthenticated = meQuery.error instanceof ApiClientError && meQuery.error.status === 401;

  const status: AuthStatus = unauthenticated
    ? 'anonymous'
    : meQuery.isError
      ? 'error'
      : meQuery.data
        ? 'authenticated'
        : 'loading';

  const value = useMemo<AuthContextValue>(
    () => ({ user: meQuery.data ?? null, status, login, register, resetPassword, logout, retry }),
    [meQuery.data, status, login, register, resetPassword, logout, retry]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
