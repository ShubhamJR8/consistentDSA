import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../hooks/useAuth';
import { ApiClientError } from '../services/api';
import { registerSchema, type RegisterInput } from '../types/auth';
import { fromApiIssues, fromZodError, type FieldErrors } from '../utils/formErrors';

export function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState<RegisterInput>({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: register,
    onError: (error) => {
      if (error instanceof ApiClientError) setFieldErrors(fromApiIssues(error.issues));
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = registerSchema.safeParse(form);
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
      <h1 className="text-xl font-semibold text-white">Create your account</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Your account is private. Nothing you do here is public.
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
          label="Name"
          name="name"
          autoComplete="name"
          value={form.name}
          error={fieldErrors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={form.email}
          error={fieldErrors.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          value={form.password}
          error={fieldErrors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{' '}
        <Link to="/login" className="text-zinc-200 underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
