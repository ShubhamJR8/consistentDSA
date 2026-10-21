import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { ApiClientError } from '../services/api';
import { authService } from '../services/auth.service';
import { forgotPasswordSchema, type ForgotPasswordInput } from '../types/auth';
import { fromApiIssues, fromZodError, type FieldErrors } from '../utils/formErrors';

export function ForgotPasswordPage() {
  const [form, setForm] = useState<ForgotPasswordInput>({ email: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: authService.forgotPassword,
    onError: (error) => {
      if (error instanceof ApiClientError) setFieldErrors(fromApiIssues(error.issues));
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = forgotPasswordSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(fromZodError(parsed.error));
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data);
  };

  const formError =
    mutation.error && Object.keys(fieldErrors).length === 0 ? mutation.error.message : null;

  if (mutation.isSuccess) {
    return (
      <>
        <h1 className="text-xl font-semibold text-white">Check your email</h1>
        <p className="mt-1 text-sm text-zinc-400">
          If an account exists for <span className="text-zinc-200">{form.email}</span>, we&apos;ve
          sent a link to reset your password.
        </p>
        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link to="/login" className="text-zinc-200 underline-offset-4 hover:underline">
            Back to log in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-white">Reset your password</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

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
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={form.email}
          error={fieldErrors.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Remembered it?{' '}
        <Link to="/login" className="text-zinc-200 underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
