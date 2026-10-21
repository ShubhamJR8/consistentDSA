import { cn } from '../utils/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className
      )}
    />
  );
}
