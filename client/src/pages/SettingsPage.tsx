import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../hooks/useAuth';
import { useConnectLeetCode } from '../hooks/useUser';
import { authService } from '../services/auth.service';

export function SettingsPage() {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const mutation = useConnectLeetCode();
  const resendVerification = useMutation({ mutationFn: authService.resendVerification });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim()) return;
    mutation.mutate(username.trim());
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
      <p className="mt-2 text-zinc-400">
        Manage how CommitDSA verifies your work outside the built-in editor.
      </p>

      <section className="mt-8 rounded-xl border border-border-muted bg-surface-200 p-5">
        <h2 className="text-lg font-medium text-white">Account</h2>
        <p className="mt-1 text-sm text-zinc-400">{user?.email}</p>

        {user?.emailVerified ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-protected/40 bg-protected/5 px-3 py-2 text-sm text-protected">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Email verified
          </p>
        ) : (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border-muted bg-surface-300 px-3 py-2">
            <p className="text-sm text-zinc-400">Email not verified.</p>
            <Button
              type="button"
              variant="secondary"
              loading={resendVerification.isPending}
              disabled={resendVerification.isSuccess}
              onClick={() => resendVerification.mutate()}
            >
              {resendVerification.isSuccess ? 'Link sent' : 'Resend link'}
            </Button>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border-muted bg-surface-200 p-5">
        <h2 className="text-lg font-medium text-white">LeetCode Account</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Connect your public LeetCode username and we&apos;ll automatically check off problems
          you solve there for today&apos;s commitment — no password, no browser extension, and
          nothing is ever posted to LeetCode on your behalf.
        </p>

        {user?.leetcodeUsername && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-protected/40 bg-protected/5 px-3 py-2 text-sm text-protected">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Connected as <span className="font-medium">{user.leetcodeUsername}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <Input
              label="LeetCode username"
              name="leetcodeUsername"
              placeholder="e.g. shubham123"
              value={username}
              error={mutation.error?.message}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <Button type="submit" loading={mutation.isPending}>
            {user?.leetcodeUsername ? 'Update & Verify' : 'Connect & Verify'}
          </Button>
        </form>

        {mutation.isSuccess && (
          <p className="mt-3 text-sm text-protected">LeetCode account connected.</p>
        )}
      </section>
    </div>
  );
}
