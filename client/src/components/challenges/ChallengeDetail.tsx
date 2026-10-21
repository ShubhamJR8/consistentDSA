import { Link } from 'react-router-dom';
import { buttonClasses } from '../buttonClasses';
import { Spinner } from '../Spinner';
import { useAuth } from '../../hooks/useAuth';
import { useCommitmentOptions, usePlan } from '../../hooks/useCommitments';
import type { Difficulty } from '../../types/commitment';
import { cn } from '../../utils/cn';
import { suggestPace } from '../../utils/commitment';
import { formatINR } from '../../utils/format';
import { TierBadge } from './TierBadge';

const DIFFICULTY_DOT: Record<Difficulty, string> = {
  Easy: 'bg-protected',
  Medium: 'bg-warning',
  Hard: 'bg-risk',
};

export function ChallengeDetailEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-border-muted px-6 py-10 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">No selection</p>
      <p className="mt-2 text-sm text-zinc-400">Pick a challenge card to see the full breakdown.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-zinc-100">{value}</dd>
    </div>
  );
}

interface ChallengeDetailProps {
  id: string;
}

export function ChallengeDetail({ id }: ChallengeDetailProps) {
  const { data: plan, isPending, isError } = usePlan(id);
  const optionsQuery = useCommitmentOptions();
  const { status } = useAuth();
  const signedIn = status !== 'anonymous';

  if (isPending || optionsQuery.isPending) {
    return (
      <div className="flex min-h-[16rem] items-center justify-center rounded-xl border border-border-subtle bg-surface-200">
        <Spinner className="h-5 w-5 text-zinc-500" />
      </div>
    );
  }

  if (isError || !plan || optionsQuery.isError || !optionsQuery.data) {
    return (
      <div className="rounded-xl border border-risk/40 bg-risk/10 px-6 py-8 text-center text-sm text-risk">
        Couldn&apos;t load this challenge. Try selecting it again.
      </div>
    );
  }

  const options = optionsQuery.data;
  const pace = suggestPace(plan.problemCount, options);

  const counts = plan.problems.reduce(
    (acc, p) => {
      acc[p.difficulty] += 1;
      return acc;
    },
    { Easy: 0, Medium: 0, Hard: 0 } as Record<Difficulty, number>
  );

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-200">
      <div className="border-b border-border-subtle px-5 py-4">
        <TierBadge level={plan.level} />
        <h2 className="mt-3 text-lg font-semibold text-white">{plan.name}</h2>
        <p className="mt-1 text-sm text-zinc-400">{plan.description}</p>

        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs">
          {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
            <div key={d} className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', DIFFICULTY_DOT[d])} aria-hidden />
              <dt className="uppercase tracking-widest text-zinc-500">{d}</dt>
              <dd className="text-zinc-200">{counts[d]}</dd>
            </div>
          ))}
        </dl>

        {pace ? (
          <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-border-subtle bg-surface-100 px-4 py-3">
            <Stat label="Duration" value={`${pace.durationDays} days`} />
            <Stat label="Daily pace" value={`${pace.dailyTarget}/day`} />
            <Stat
              label="Deposit"
              value={`${formatINR(Math.min(...options.depositAmounts))}–${formatINR(Math.max(...options.depositAmounts))}`}
            />
          </dl>
        ) : (
          <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning">
            This plan has no problems yet — check back soon.
          </div>
        )}

        <p className="mt-3 text-xs text-zinc-500">
          Missing a day forfeits {options.rules.forfeiturePerMissedDay}% of your deposit for that
          day. Rules lock in when you commit.
        </p>
      </div>

      <ol className="max-h-96 divide-y divide-border-subtle overflow-y-auto">
        {plan.problems.map((problem, index) => (
          <li key={problem.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="w-6 shrink-0 font-mono text-xs text-zinc-600">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                DIFFICULTY_DOT[problem.difficulty]
              )}
              aria-hidden
            />
            <a
              href={problem.url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 truncate text-zinc-200 transition-colors hover:text-white"
            >
              {problem.title}
            </a>
            <span className="shrink-0 text-xs text-zinc-500">{problem.topic}</span>
          </li>
        ))}
      </ol>

      <div className="border-t border-border-subtle p-4">
        {pace || !signedIn ? (
          <Link
            // Carrying the chosen plan and daily target along lets the wizard skip straight to
            // the deposit step instead of re-asking choices we've already shown here. Duration
            // isn't carried — it's derived from these two, never a separate choice.
            to={
              signedIn
                ? `/commitment/new?plan=${plan.id}&dailyTarget=${pace?.dailyTarget}`
                : '/register'
            }
            className={buttonClasses({ className: 'w-full' })}
          >
            {signedIn ? 'Start this challenge' : 'Sign up to start'}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className={buttonClasses({ variant: 'secondary', className: 'w-full' })}
          >
            No problems in this plan yet
          </button>
        )}
      </div>
    </div>
  );
}
