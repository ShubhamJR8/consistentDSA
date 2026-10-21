import type { ButtonHTMLAttributes } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonClasses';
import { Spinner } from './Spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant,
  size,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
