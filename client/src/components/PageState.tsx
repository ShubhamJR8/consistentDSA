import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-zinc-400">
      <Spinner className="h-6 w-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoadingState />
    </div>
  );
}

interface MessageStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function ErrorState({ title, description, action }: MessageStateProps) {
  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description && <p className="text-sm text-zinc-400">{description}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: MessageStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-border-muted bg-surface-200 px-6 py-12 text-center">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">{description}</p>}
      {action && <div className="mt-6 flex flex-col items-center gap-2">{action}</div>}
    </div>
  );
}
