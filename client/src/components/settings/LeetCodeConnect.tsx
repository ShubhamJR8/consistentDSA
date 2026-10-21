import { useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, ExternalLink } from 'lucide-react';
import { Button } from '../Button';
import { Input } from '../Input';
import { useAuth } from '../../hooks/useAuth';
import {
  useDisconnectLeetCode,
  useLeetCodeChallenge,
  useVerifyLeetCode,
} from '../../hooks/useLeetCode';
import { ApiClientError } from '../../services/api';

const errorMessage = (error: Error | null): string | undefined => {
  if (!error) return undefined;
  // The server already words these for users; the 503 is the retryable "LeetCode unreachable" case.
  return error instanceof ApiClientError && error.code === 'LEETCODE_UNAVAILABLE'
    ? `${error.message} (Your challenge is still valid.)`
    : error.message;
};

/** Ownership-based LeetCode connection: generate a one-time token, paste it into the LeetCode About
 *  field, then verify. We never ask for a password, cookie or session token. */
export function LeetCodeConnect() {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [changing, setChanging] = useState(false);
  const [copied, setCopied] = useState(false);
  const challenge = useLeetCodeChallenge();
  const verify = useVerifyLeetCode();
  const disconnect = useDisconnectLeetCode();

  const connected = Boolean(user?.leetcodeUsername);
  const showForm = !connected || changing;
  const active = challenge.data;

  const handleGenerate = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim()) return;
    verify.reset();
    setCopied(false);
    challenge.mutate(username.trim());
  };

  const handleCopy = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.token);
    setCopied(true);
  };

  return (
    <section className="mt-6 rounded-xl border border-border-muted bg-surface-200 p-5">
      <h2 className="text-lg font-medium text-white">LeetCode Account</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Prove you own your LeetCode account and we&apos;ll automatically check off the problems you
        solve there. No password, cookie or browser extension — and nothing is ever posted to
        LeetCode on your behalf.
      </p>

      {connected && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-protected/40 bg-protected/5 px-3 py-2">
          <p className="flex items-center gap-2 text-sm text-protected">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Verified as <span className="font-medium">{user?.leetcodeUsername}</span>
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setChanging((value) => !value)}
            >
              {changing ? 'Cancel' : 'Change account'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
      {disconnect.isError && (
        <p role="alert" className="mt-2 text-sm text-risk">
          {disconnect.error.message}
        </p>
      )}

      {showForm && (
        <>
          {connected && (
            <p className="mt-3 text-sm text-zinc-500">
              Changing accounts disconnects the current one until the new one is verified.
            </p>
          )}
          <form onSubmit={handleGenerate} noValidate className="mt-4 flex items-end gap-3">
            <div className="flex-1">
              <Input
                label="LeetCode username"
                name="leetcodeUsername"
                placeholder="e.g. shubham123"
                value={username}
                error={active ? undefined : challenge.error?.message}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <Button type="submit" loading={challenge.isPending}>
              {active ? 'New challenge' : 'Connect'}
            </Button>
          </form>
        </>
      )}

      {showForm && active && !verify.isSuccess && (
        <div className="mt-4 space-y-3 rounded-lg border border-border-muted bg-surface-300 p-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-300">
            <li>Copy your one-time challenge.</li>
            <li>
              Open your{' '}
              <a
                href="https://leetcode.com/profile/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                LeetCode profile <ExternalLink className="h-3 w-3" aria-hidden />
              </a>{' '}
              and edit the About / README field.
            </li>
            <li>Paste the challenge into it and save.</li>
            <li>Come back here and press Verify ownership.</li>
          </ol>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-border-muted bg-surface-100 px-3 py-2 font-mono text-sm text-zinc-100">
              {active.token}
            </code>
            <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
              <Copy className="h-4 w-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Expires at {new Date(active.expiresAt).toLocaleTimeString()}. You can remove it from
            your profile once verified.
          </p>
          <Button
            type="button"
            loading={verify.isPending}
            onClick={() => verify.mutate(active.username)}
          >
            Verify ownership
          </Button>
          {verify.isError && (
            <p role="alert" className="text-sm text-risk">
              {errorMessage(verify.error)}
            </p>
          )}
        </div>
      )}

      {verify.isSuccess && (
        <p className="mt-3 flex items-center gap-2 text-sm text-protected">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> LeetCode account verified.
        </p>
      )}
    </section>
  );
}
