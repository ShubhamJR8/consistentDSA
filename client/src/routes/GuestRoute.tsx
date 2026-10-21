import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function GuestRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'anonymous') return <Outlet />;

  const from = (location.state as { from?: string } | null)?.from;
  return <Navigate to={from ?? '/dashboard'} replace />;
}
