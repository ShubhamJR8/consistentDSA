import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../services/api';
import { authService } from '../services/auth.service';
import { ME_KEY } from '../context/auth-context';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const queryClient = useQueryClient();
  const attempted = useRef(false);

  const mutation = useMutation({
    mutationFn: authService.verifyEmail,
    onSuccess: (user) => {
      // If this browser already has a session for this account, reflect the new
      // verified status immediately instead of waiting on the next /me refetch.
      queryClient.setQueryData(ME_KEY, user);
    },
  });

  useEffect(() => {
    if (token && !attempted.current) {
      attempted.current = true;
      mutation.mutate({ token });
    }
  }, [token, mutation]);

  if (!token) {
    return (
      <>
        <h1 className="text-xl font-semibold text-white">Invalid link</h1>
        <p className="mt-1 text-sm text-zinc-400">This verification link is missing its token.</p>
        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link to="/login" className="text-zinc-200 underline-offset-4 hover:underline">
            Back to log in
          </Link>
        </p>
      </>
    );
  }

  if (mutation.isSuccess) {
    return (
      <>
        <h1 className="text-xl font-semibold text-white">Email verified</h1>
        <p className="mt-1 text-sm text-zinc-400">Your email address has been confirmed.</p>
        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link to="/dashboard" className="text-zinc-200 underline-offset-4 hover:underline">
            Go to dashboard
          </Link>
        </p>
      </>
    );
  }

  if (mutation.isError) {
    const message =
      mutation.error instanceof ApiClientError
        ? mutation.error.message
        : 'Something went wrong. Please try again.';
    return (
      <>
        <h1 className="text-xl font-semibold text-white">Verification failed</h1>
        <p className="mt-1 text-sm text-risk">{message}</p>
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
      <h1 className="text-xl font-semibold text-white">Verifying your email&hellip;</h1>
      <p className="mt-1 text-sm text-zinc-400">This will only take a moment.</p>
    </>
  );
}
