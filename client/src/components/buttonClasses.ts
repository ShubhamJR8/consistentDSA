import { cn } from '../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'border border-border-muted bg-surface-100 text-zinc-100 hover:bg-surface-50',
  ghost: 'text-zinc-300 hover:bg-surface-100 hover:text-white',
};

const sizes: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-6 text-base',
};

export const buttonClasses = ({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string => cn(base, variants[variant], sizes[size], className);
