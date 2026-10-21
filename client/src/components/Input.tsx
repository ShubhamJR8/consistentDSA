import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className, id, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'block min-h-11 w-full rounded-lg border bg-surface-200 px-3 text-base text-zinc-100',
          'placeholder:text-zinc-600 focus:border-primary',
          error ? 'border-risk/70' : 'border-border-muted',
          className
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-risk">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
