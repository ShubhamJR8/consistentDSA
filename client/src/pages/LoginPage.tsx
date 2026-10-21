import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../hooks/useAuth';
import { ApiClientError } from '../services/api';
import { loginSchema, type LoginInput } from '../types/auth';
import { fromApiIssues, fromZodError, type FieldErrors } from '../utils/formErrors';

export function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState<LoginInput>({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: login,
    onError: (error) => {
      if (error instanceof ApiClientError) setFieldErrors(fromApiIssues(error.issues));
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(fromZodError(parsed.error));
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data);
  };

  const formError =
    mutation.error && Object.keys(fieldErrors).length === 0 ? mutation.error.message : null;

  return (
    <>
      <h1 className="text-xl font-semibold text-white">Welcome back</h1>
      <p className="mt-1 text-sm text-zinc-400">Log in to see today&apos;s commitment.</p>

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
        <div>
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={form.password}
            error={fieldErrors.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <Link
            to="/forgot-password"
            className="mt-1.5 inline-block text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Log in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        New here?{' '}
        <Link to="/register" className="text-zinc-200 underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
