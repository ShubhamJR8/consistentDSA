import { useAuth } from './useAuth';

export function useCtaTarget(): string {
  const { status } = useAuth();
  return status === 'anonymous' ? '/register' : '/dashboard';
}
