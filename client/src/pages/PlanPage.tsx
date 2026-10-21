import { ArrowLeft, Check, ExternalLink, Lock, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { buttonClasses } from '../components/buttonClasses';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/PageState';
import { useProgress, useToday } from '../hooks/useCommitments';
import type { Difficulty, ProgressDay, TodayProblem } from '../types/commitment';
import { cn } from '../utils/cn';
import { formatDayKey } from '../utils/format';

const BackLink = () => (
  <Link
    to="/dashboard"
    className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"
  >
    <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
  </Link>
);

type DayState = 'completed' | 'missed' | 'today' | 'upcoming';

const stateOf = (day: ProgressDay): DayState => {
  if (day.status === 'COMPLETED') return 'completed';
  if (day.status === 'MISSED') return 'missed';
  return day.isToday ? 'today' : 'upcoming';
};

const DAY_BADGE_STYLES: Record<DayState, string> = {
  completed: 'border-protected/50 bg-protected/15 text-protected',
  missed: 'border-risk/50 bg-risk/10 text-risk',
  today: 'border-primary bg-primary/15 text-white',
  upcoming: 'border-border-subtle text-zinc-500',
};

const DAY_LABEL: Record<DayState, string> = {
  completed: 'Completed',
  missed: 'Missed',
  today: 'Today',
  upcoming: 'Upcoming',
};

const DAY_LABEL_TEXT: Record<DayState, string> = {
  completed: 'text-protected',
  missed: 'text-risk',
  today: 'text-primary',
  upcoming: 'text-zinc-500',
};

const DIFFICULTY_DOT: Record<Difficulty, string> = {
  Easy: 'bg-protected',
  Medium: 'bg-warning',
  Hard: 'bg-risk',
};

/** Today's and past problems can be opened; upcoming ones are shown so the roadmap is visible up
 *  front (the plan's full problem list is already public before committing), but stay locked —
 *  no links, no ticks — until their day actually arrives. */
function ProblemRow({ problem, dayState }: { problem: TodayProblem; dayState: DayState }) {
  const locked = dayState === 'upcoming';

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
        locked
          ? 'border-border-subtle/60 text-zinc-600'
          : problem.completed
            ? 'border-protected/30 bg-protected/5'
            : 'border-border-muted bg-surface-200'
      )}
    >
      {locked ? (
        <Lock className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
      ) : problem.completed ? (
        <Check className="h-4 w-4 shrink-0 text-protected" aria-hidden />
      ) : dayState === 'missed' ? (
        <X className="h-4 w-4 shrink-0 text-risk" aria-hidden />
      ) : (
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DIFFICULTY_DOT[problem.difficulty])}
          aria-hidden
        />
      )}
      <span className={cn('flex-1 truncate', locked ? '' : problem.completed && 'text-zinc-400')}>
        {problem.title}
      </span>
      <span className="shrink-0 text-xs text-zinc-500">{problem.topic}</span>
      {!locked && (
        <a
          href={problem.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-zinc-500 hover:text-white"
          aria-label={`Open ${problem.title} on ${problem.source}`}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </li>
  );
}

function DayCard({ day, commitmentId }: { day: ProgressDay; commitmentId: string }) {
  const state = stateOf(day);
  return (
    <li className="rounded-xl border border-border-subtle bg-surface-100 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-medium tabular-nums',
              DAY_BADGE_STYLES[state]
            )}
          >
            {day.dayNumber}
          </span>
          <div>
            <p className="text-sm font-medium text-white">Day {day.dayNumber}</p>
            <p className="text-xs text-zinc-500">{formatDayKey(day.date)}</p>
          </div>
        </div>
        <div className="text-right">
          <span className={cn('text-xs font-medium', DAY_LABEL_TEXT[state])}>
            {DAY_LABEL[state]}
          </span>
          <p className="mt-0.5 text-xs text-zinc-500">
            {day.completedProblems} / {day.requiredProblems} solved
          </p>
        </div>
      </div>

      {state === 'today' && (
        <Link
          to={`/commitment/${commitmentId}/today`}
          className={buttonClasses({ variant: 'secondary', className: 'mt-3 w-full text-sm' })}
        >
          Continue today&apos;s commitment
        </Link>
      )}

      <ul className="mt-3 space-y-1.5">
        {day.problems.map((problem) => (
          <ProblemRow key={problem.id} problem={problem} dayState={state} />
        ))}
      </ul>
    </li>
  );
}

export function PlanPage() {
  const { id = '' } = useParams();
  const progressQuery = useProgress(id);
  // Reused only for `phase` — it tells us *why* every day might still be locked (the whole
  // commitment hasn't started yet, vs. today just hasn't arrived on an active one).
  const todayQuery = useToday(id);

  if (progressQuery.isPending || todayQuery.isPending) return <LoadingState />;

  if (progressQuery.isError || todayQuery.isError || !progressQuery.data || !todayQuery.data) {
    return (
      <ErrorState
        title="We couldn't load this commitment's plan"
        description={(progressQuery.error ?? todayQuery.error)?.message}
        action={
          <Button
            onClick={() => {
              void progressQuery.refetch();
              void todayQuery.refetch();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const { commitment, days } = progressQuery.data;
  const { phase } = todayQuery.data;
  const totalCompleted = days.reduce((sum, d) => sum + d.completedProblems, 0);

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink />
      <h1 className="text-2xl font-semibold tracking-tight text-white">{commitment.planName}</h1>
      <p className="mt-1 text-zinc-400">
        {totalCompleted} / {commitment.totalProblems} problems completed &middot;{' '}
        {commitment.durationDays}-day commitment
      </p>

      {phase === 'NOT_STARTED' && commitment.startDate && (
        <p className="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-zinc-300">
          Your commitment hasn&apos;t started yet — Day 1 unlocks on{' '}
          {formatDayKey(commitment.startDate)}. Every day below is locked until its date arrives,
          same as during the challenge.
        </p>
      )}

      <ol className="mt-6 space-y-3">
        {days.map((day) => (
          <DayCard key={day.date} day={day} commitmentId={id} />
        ))}
      </ol>
    </div>
  );
}
