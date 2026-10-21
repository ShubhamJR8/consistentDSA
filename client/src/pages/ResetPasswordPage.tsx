import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../hooks/useAuth';
import { ApiClientError } from '../services/api';
import { resetPasswordSchema, type ResetPasswordInput } from '../types/auth';
import { fromApiIssues, fromZodError, type FieldErrors } from '../utils/formErrors';

export function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: resetPassword,
    onSuccess: () => navigate('/dashboard', { replace: true }),
    onError: (error) => {
      if (error instanceof ApiClientError) setFieldErrors(fromApiIssues(error.issues));
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = resetPasswordSchema.safeParse({ token, password } satisfies ResetPasswordInput);
    if (!parsed.success) {
      setFieldErrors(fromZodError(parsed.error));
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data);
  };

  const formError =
    mutation.error && Object.keys(fieldErrors).length === 0 ? mutation.error.message : null;

  if (!token) {
    return (
      <>
        <h1 className="text-xl font-semibold text-white">Invalid link</h1>
        <p className="mt-1 text-sm text-zinc-400">
          This reset link is missing its token. Request a new one below.
        </p>
        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link to="/forgot-password" className="text-zinc-200 underline-offset-4 hover:underline">
            Request a new link
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-white">Choose a new password</h1>
      <p className="mt-1 text-sm text-zinc-400">You&apos;ll be logged in automatically.</p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-risk/40 bg-risk/10 px-3 py-2 text-sm text-risk"
          >
            {formError}
          </p>
        )}
        <Input
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          value={password}
          error={fieldErrors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Reset password
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        <Link to="/login" className="text-zinc-200 underline-offset-4 hover:underline">
          Back to log in
        </Link>
      </p>
    </>
  );
}
