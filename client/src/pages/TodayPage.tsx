import { ArrowLeft, CheckCircle2, Code2, ExternalLink, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { buttonClasses } from '../components/buttonClasses';
import { ErrorState, LoadingState } from '../components/PageState';
import { ApiClientError } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
  useCompleteDay,
  useSetProblemCompletion,
  useToday,
  useVerifyToday,
} from '../hooks/useCommitments';
import type { LeetCodeVerifyResult, TodayProblem } from '../types/commitment';
import { todayMessage } from '../utils/commitment';
import { formatDayKey, formatDeadline } from '../utils/format';

interface VerificationLine {
  text: string;
  done: boolean;
}

/** Each problem gets its own status — one being verified says nothing about the others. */
const verificationLine = (
  problem: TodayProblem,
  result: LeetCodeVerifyResult | undefined,
  checking: boolean,
  connected: boolean
): VerificationLine => {
  if (problem.completed) {
    return {
      text:
        problem.completionMethod === 'LEETCODE' ? 'Completed — verified on LeetCode' : 'Completed',
      done: true,
    };
  }
  if (!connected) return { text: 'Account connection required', done: false };
  if (checking) return { text: 'Verifying…', done: false };

  const outcome = result?.problems.find((p) => p.problemId === problem.id);
  switch (outcome?.status) {
    case 'TEMPORARILY_UNAVAILABLE':
      return { text: 'Verification temporarily unavailable', done: false };
    case 'CONFIGURATION_ERROR':
      return { text: "Can't be verified automatically", done: false };
    case 'PENDING':
      return {
        text:
          outcome.reason === 'history_truncated'
            ? 'Waiting for an Accepted submission (we can only see your latest 20 — check again soon)'
            : 'Waiting for an Accepted submission',
        done: false,
      };
    default:
      return { text: 'Waiting for an Accepted submission', done: false };
  }
};

const BackLink = () => (
  <Link
    to="/dashboard"
    className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"
  >
    <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
  </Link>
);

export function TodayPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const todayQuery = useToday(id);
  const setProblem = useSetProblemCompletion(id);
  const completeDay = useCompleteDay(id);
  const verifyToday = useVerifyToday(id);

  if (todayQuery.isPending) return <LoadingState />;

  if (todayQuery.isError || !todayQuery.data) {
    const error = todayQuery.error;
    const notActive = error instanceof ApiClientError && error.code === 'COMMITMENT_NOT_ACTIVE';
    return (
      <ErrorState
        title={notActive ? 'This commitment is not active' : "We couldn't load today's commitment"}
        description={error?.message}
        action={
          <Link to="/dashboard" className={buttonClasses({ variant: 'secondary' })}>
            Back to dashboard
          </Link>
        }
      />
    );
  }

  const { phase, commitment, today } = todayQuery.data;

  if (phase !== 'IN_PROGRESS' || !today) {
    return (
      <>
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {phase === 'NOT_STARTED'
            ? 'Your commitment has not started yet'
            : 'Your challenge period has ended'}
        </h1>
        <p className="mt-2 text-zinc-400">
          {phase === 'NOT_STARTED' && commitment.startDate
            ? `Day 1 starts on ${formatDayKey(commitment.startDate)}.`
            : 'Final evaluation and refunds arrive in the next phase.'}
        </p>
      </>
    );
  }

  const locked = today.status === 'COMPLETED';
  const allChecked = today.completedProblems >= today.requiredProblems;
  // With a verified account LeetCode problems are checked off by their Accepted submission only.
  const autoVerified = Boolean(user?.leetcodeUsername);
  const busy = setProblem.isPending || completeDay.isPending;
  const error = setProblem.error ?? completeDay.error;

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink />
      <p className="text-sm text-zinc-400">
        Day {today.dayNumber} of {commitment.durationDays} · {formatDayKey(today.date)}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Today&apos;s Goal</h1>
      <p className={`mt-2 ${locked ? 'text-protected' : 'text-zinc-300'}`}>{todayMessage(today)}</p>

      <ul className="mt-6 space-y-3">
        {today.problems.map((problem) =>
          problem.judgeEnabled ? (
            <li key={problem.id} className="flex items-stretch gap-2">
              <Link
                to={`/commitment/${id}/today/problems/${problem.id}/editor`}
                className={`flex min-h-14 flex-1 items-start gap-3 rounded-xl border px-4 py-3 ${
                  problem.completed
                    ? 'border-protected/40 bg-protected/5'
                    : 'border-border-muted bg-surface-200 hover:bg-surface-100'
                }`}
              >
                {problem.completed ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-protected" aria-hidden />
                ) : (
                  <Code2 className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" aria-hidden />
                )}
                <span>
                  <span
                    className={`block font-medium ${problem.completed ? 'text-zinc-400 line-through' : 'text-white'}`}
                  >
                    {problem.title}
                  </span>
                  <span className="mt-0.5 block text-sm text-zinc-500">
                    {problem.difficulty} · {problem.topic} ·{' '}
                    {problem.completed ? 'Solved in editor' : 'Solve in editor'}
                  </span>
                </span>
              </Link>
            </li>
          ) : (
            <li key={problem.id} className="flex items-stretch gap-2">
              <label
                className={`flex min-h-14 flex-1 items-start gap-3 rounded-xl border px-4 py-3 ${
                  problem.completed
                    ? 'border-protected/40 bg-protected/5'
                    : 'border-border-muted bg-surface-200'
                } ${locked ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-emerald-500"
                  checked={problem.completed}
                  disabled={locked || busy || (autoVerified && problem.source === 'LeetCode')}
                  onChange={(event) =>
                    setProblem.mutate({ problemId: problem.id, completed: event.target.checked })
                  }
                />
                <span>
                  <span
                    className={`block font-medium ${problem.completed ? 'text-zinc-400 line-through' : 'text-white'}`}
                  >
                    {problem.title}
                  </span>
                  <span className="mt-0.5 block text-sm text-zinc-500">
                    {problem.difficulty} · {problem.topic}
                  </span>
                </span>
              </label>
              <a
                href={problem.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-12 shrink-0 items-center justify-center rounded-xl border border-border-muted bg-surface-200 text-zinc-400 hover:text-white"
                aria-label={`Open ${problem.title} on ${problem.source}`}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </li>
          )
        )}
      </ul>

      {!locked && (
        <section
          aria-label="LeetCode verification"
          className="mt-4 rounded-xl border border-border-muted bg-surface-200 p-4"
        >
          <ul className="space-y-2">
            {today.problems.map((problem) => {
              const line = verificationLine(
                problem,
                verifyToday.data,
                verifyToday.isPending,
                Boolean(user?.leetcodeUsername)
              );
              return (
                <li key={problem.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-zinc-300">{problem.title}</span>
                  <span className={line.done ? 'text-protected' : 'text-zinc-500'}>
                    {line.text}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-muted pt-4">
            {user?.leetcodeUsername ? (
              <>
                <p className="text-sm text-zinc-400">
                  Solved one on LeetCode already? We check automatically, or you can check now.
                </p>
                <Button
                  variant="secondary"
                  loading={verifyToday.isPending}
                  onClick={() => verifyToday.mutate()}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden /> Check submission
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-zinc-400">
                  Connect your LeetCode account to have solved problems checked off automatically.
                </p>
                <Link to="/settings" className={buttonClasses({ variant: 'secondary' })}>
                  Connect LeetCode
                </Link>
              </>
            )}
          </div>

          {verifyToday.isSuccess && (
            <p role="status" className="mt-3 text-sm text-zinc-400">
              {verifyToday.data.dayCompleted
                ? "✓ All of today's problems are verified — today's commitment is complete."
                : verifyToday.data.verifiedProblemIds.length > 0
                  ? `✓ Verified ${verifyToday.data.verifiedProblemIds.length} problem${verifyToday.data.verifiedProblemIds.length > 1 ? 's' : ''} from LeetCode.`
                  : !verifyToday.data.providerAvailable
                    ? "LeetCode verification is temporarily unavailable. Your commitment has not been marked as missed because of this — we'll keep retrying."
                    : 'No accepted submission found yet. Make sure you solved today’s assigned problem with your connected LeetCode account.'}
            </p>
          )}
          {verifyToday.isError && (
            <p role="alert" className="mt-3 text-sm text-risk">
              {verifyToday.error.message}
            </p>
          )}
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-risk/40 bg-risk/10 px-3 py-2 text-sm text-risk"
        >
          {error.message}
        </p>
      )}

      {!locked && (
        <div className="mt-6">
          <Button
            className="w-full sm:w-auto"
            size="lg"
            disabled={!allChecked}
            loading={completeDay.isPending}
            onClick={() => completeDay.mutate()}
          >
            Mark Today&apos;s Commitment Complete
          </Button>
        </div>
      )}

      <p className="mt-6 text-sm text-zinc-500">
        Deadline: {formatDeadline(today.deadlineAt, commitment.timezone)} ({commitment.timezone}).
        Days can&apos;t be completed after the deadline.
      </p>
    </div>
  );
}
