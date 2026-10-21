import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button } from '../components/Button';
import { ErrorState, FullPageLoader } from '../components/PageState';
import { useAuth } from '../hooks/useAuth';

export function ProtectedRoute() {
  const { status, retry, logout } = useAuth();
  const location = useLocation();

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'error') {
    return (
      <ErrorState
        title="We couldn't load your account"
        description="This is usually a temporary connection problem. Your commitment data is safe."
        action={
          <>
            <Button onClick={retry}>Try again</Button>
            <Button variant="ghost" onClick={logout}>
              Log out
            </Button>
          </>
        }
      />
    );
  }
  return <Outlet />;
}
