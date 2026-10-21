import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChallengeCard } from '../components/challenges/ChallengeCard';
import { ChallengeDetail, ChallengeDetailEmpty } from '../components/challenges/ChallengeDetail';
import { ErrorState, LoadingState } from '../components/PageState';
import { Button } from '../components/Button';
import { usePlans } from '../hooks/useCommitments';
import type { PlanLevel, PlanSummary } from '../types/commitment';
import { cn } from '../utils/cn';

const LEVEL_ORDER: PlanLevel[] = ['Basic', 'Medium', 'Advanced'];

const TABS: { label: string; value: PlanLevel | 'All' }[] = [
  { label: 'All', value: 'All' },
  { label: 'Basic', value: 'Basic' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Advanced', value: 'Advanced' },
];

const pad = (n: number) => String(n).padStart(2, '0');

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
    </div>
  );
}

function ChallengesContent() {
  const { data: plans, isPending, isError, refetch } = usePlans();
  const [tab, setTab] = useState<PlanLevel | 'All'>('All');
  // Deep links can land here with ?select=<id> so a specific plan opens pre-selected rather than
  // dropping the visitor at an empty panel.
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('select'));

  // A plan is one of three shapes: the single combined 150-problem track (no topic, no level),
  // a tier track combining every topic at one level (no topic, has a level), or a per-topic
  // chapter (has both). This split drives the three sections below.
  const featured = useMemo<PlanSummary | null>(
    () => plans?.find((p) => p.topic === null && p.level === null) ?? null,
    [plans]
  );
  const tiers = useMemo<PlanSummary[]>(() => {
    const found = (plans ?? []).filter((p) => p.topic === null && p.level !== null);
    return LEVEL_ORDER.map((level) => found.find((p) => p.level === level)).filter(
      (p): p is PlanSummary => p !== undefined
    );
  }, [plans]);
  const chapters = useMemo<PlanSummary[]>(() => {
    const found = (plans ?? []).filter((p) => p.topic !== null);
    return tab === 'All' ? found : found.filter((p) => p.level === tab);
  }, [plans, tab]);

  const select = (id: string) => setSelectedId((current) => (current === id ? null : id));

  if (isPending) return <LoadingState label="Loading challenges…" />;
  if (isError || !plans) {
    return (
      <ErrorState
        title="We couldn't load the challenges"
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[1fr_400px] lg:items-start lg:gap-8">
      <div className="space-y-10">
        {featured && (
          <section>
            <ChallengeCard
              plan={featured}
              label="★ FEATURED"
              accent
              selected={selectedId === featured.id}
              onSelect={() => select(featured.id)}
            />
            {selectedId === featured.id && (
              <div className="mt-4 lg:hidden">
                <ChallengeDetail id={featured.id} />
              </div>
            )}
          </section>
        )}

        {tiers.length > 0 && (
          <section>
            <SectionHeading eyebrow="Pick your level" title="Three tiers, all topics combined" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {tiers.map((plan, index) => (
                <Fragment key={plan.id}>
                  <ChallengeCard
                    plan={plan}
                    label={`TR.${pad(index + 1)}`}
                    selected={selectedId === plan.id}
                    onSelect={() => select(plan.id)}
                  />
                  {selectedId === plan.id && (
                    <div className="sm:col-span-3 lg:hidden">
                      <ChallengeDetail id={plan.id} />
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionHeading eyebrow="Or go deeper" title="Chapter by chapter" />
          <div role="tablist" aria-label="Chapter tier" className="flex flex-wrap gap-2">
            {TABS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.15em] transition-colors',
                  tab === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border-subtle text-zinc-500 hover:border-border-muted hover:text-zinc-300'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {chapters.map((plan, index) => (
              <Fragment key={plan.id}>
                <ChallengeCard
                  plan={plan}
                  label={`CH.${pad(index + 1)}`}
                  selected={selectedId === plan.id}
                  onSelect={() => select(plan.id)}
                />
                {selectedId === plan.id && (
                  <div className="sm:col-span-2 lg:hidden">
                    <ChallengeDetail id={plan.id} />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </section>
      </div>

      <div className="sticky top-24 hidden lg:block">
        {selectedId ? <ChallengeDetail id={selectedId} /> : <ChallengeDetailEmpty />}
      </div>
    </div>
  );
}

export function ChallengesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">Challenges</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Every track, laid out.
      </h1>
      <p className="mt-3 max-w-2xl text-zinc-400">
        150 problems across Basic, Medium and Advanced tracks. Pick one, see exactly what&apos;s
        inside, and start your commitment.
      </p>

      <div className="mt-10">
        <ChallengesContent />
      </div>
    </div>
  );
}
