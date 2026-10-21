import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { buttonClasses } from '../components/buttonClasses';
import { Logo } from '../components/Logo';
import { useAuth } from '../hooks/useAuth';
import { useCtaTarget } from '../hooks/useCtaTarget';

function ScrollToHash() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return null;
}

function Navbar() {
  const { status } = useAuth();
  const ctaTo = useCtaTarget();
  const signedIn = status !== 'anonymous';

  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-10">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
            <Link to="/#how-it-works" className="transition-colors hover:text-white">
              How It Works
            </Link>
            <Link to="/challenges" className="transition-colors hover:text-white">
              Challenges
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {!signedIn && (
            <Link to="/login" className={buttonClasses({ variant: 'ghost' })}>
              Login
            </Link>
          )}
          <Link to={ctaTo} className={buttonClasses()}>
            {signedIn ? 'Dashboard' : 'Start Commitment'}
          </Link>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo className="text-base" />
        <p>Private accountability for developers who are serious about getting better.</p>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToHash />
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
