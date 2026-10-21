import { Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo';

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Logo className="mb-8 text-xl" />
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface-100 p-6 sm:p-8">
        <Outlet />
      </div>
    </div>
  );
}
