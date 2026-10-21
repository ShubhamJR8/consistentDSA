import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useAuth } from '../hooks/useAuth';

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Logo to="/dashboard" />
            <nav className="flex items-center gap-6 text-sm">
              <Link to="/dashboard" className="text-zinc-300 transition-colors hover:text-white">
                Dashboard
              </Link>
              <Link to="/challenges" className="text-zinc-300 transition-colors hover:text-white">
                Challenges
              </Link>
              <Link to="/settings" className="text-zinc-300 transition-colors hover:text-white">
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-500 sm:inline">{user?.email}</span>
            <Button variant="ghost" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
