import { Link } from 'react-router-dom';
import { cn } from '../utils/cn';

export function Logo({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn('text-lg font-semibold tracking-tight text-white', className)}
      aria-label="CommitDSA home"
    >
      Commit<span className="text-primary">DSA</span>
    </Link>
  );
}
