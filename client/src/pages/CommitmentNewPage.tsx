import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { buttonClasses } from '../components/buttonClasses';
import { OptionCard } from '../components/commitment/OptionCard';
import { ErrorState, LoadingState } from '../components/PageState';
import { useAuth } from '../hooks/useAuth';
import {
  useCommitmentOptions,
  useCommitments,
  useCreateCommitment,
  usePlans,
} from '../hooks/useCommitments';
import type { CommitmentOptions, PlanSummary } from '../types/commitment';
import { findOpenCommitment } from '../utils/commitment';
import { formatINR } from '../utils/format';

const STEP_TITLES = [
  'Choose your DSA plan',
  'How many problems a day?',
  'How much are you committing?',
  'Review your commitment',
];

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-zinc-400">{label}</dt>
      <dd className="text-right font-medium text-white">{value}</dd>
    </div>
  );
}

function Wizard({ options, plans }: { options: CommitmentOptions; plans: PlanSummary[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const create = useCreateCommitment();
  const [searchParams] = useSearchParams();

  // Arriving from a challenge card (?plan=<id>&dailyTarget=<n>) means the plan and daily target
  // were already shown and chosen there — re-asking them here would just repeat the same
  // "step by step" flow the card exists to skip. Duration is never part of the hand-off since
  // it's never chosen — it's always derived from these two. Only honor the hand-off when both
  // values are still valid; otherwise fall back to the full wizard from step 0.
  const requestedPlanId = searchParams.get('plan');
  const requestedDailyTarget = Number(searchParams.get('dailyTarget'));
  const requestedPlan = plans.find((p) => p.id === requestedPlanId && p.problemCount > 0);
  const prefillValid =
    requestedPlan !== undefined && options.dailyTargets.includes(requestedDailyTarget);

  const [step, setStep] = useState(prefillValid ? 2 : 0);
  const [planId, setPlanId] = useState<string | null>(() =>
    prefillValid
      ? requestedPlan.id
      : requestedPlanId && plans.some((p) => p.id === requestedPlanId)
        ? requestedPlanId
        : null
  );
  const [dailyTarget, setDailyTarget] = useState<number | null>(() =>
    prefillValid ? requestedDailyTarget : options.recommendedDailyTarget
  );
  const [depositAmount, setDepositAmount] = useState<number | null>(null);

  const plan = plans.find((p) => p.id === planId) ?? null;
  // Duration is never picked — a commitment always covers every problem in the plan, so it's
  // always exactly how long that takes at the chosen daily pace, rounded up so the last day just
  // gets whatever's left over instead of silently dropping problems off the end.
  const durationDays =
    plan !== null && dailyTarget !== null ? Math.ceil(plan.problemCount / dailyTarget) : null;
  const totalProblems = plan?.problemCount ?? null;

  const canContinue = [plan !== null, dailyTarget !== null, depositAmount !== null, true][step];

  const submit = () => {
    if (plan === null || dailyTarget === null || depositAmount === null) return;
    create.mutate(
      { planId: plan.id, dailyTarget, depositAmount },
      { onSuccess: () => navigate('/dashboard') }
    );
  };

  const percent = options.rules.forfeiturePerMissedDay;
  // Mirrors the server's check; the server still enforces it on create, payment and activation.
  const needsLeetCode = plan?.requiresLeetCode === true && !user?.leetcodeUsername;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm text-zinc-400">
        Step {step + 1} of {STEP_TITLES.length}
      </p>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {STEP_TITLES.map((title, index) => (
          <span
            key={title}
            className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-primary' : 'bg-surface-50'}`}
          />
        ))}
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{STEP_TITLES[step]}</h1>

      <div className="mt-6">
        {step === 0 && (
          <div role="radiogroup" aria-label="DSA plan" className="space-y-3">
            {plans.map((p) => (
              <OptionCard
                key={p.id}
                title={p.name}
                description={
                  p.problemCount === 0
                    ? 'No problems in this plan yet'
                    : `${p.description} ${p.problemCount} problems.`
                }
                selected={planId === p.id}
                disabled={p.problemCount === 0}
                onSelect={() => setPlanId(p.id)}
              />
            ))}
          </div>
        )}

        {step === 1 && plan !== null && (
          <div role="radiogroup" aria-label="Daily workload" className="space-y-3">
            {options.dailyTargets.map((count) => {
              const days = Math.ceil(plan.problemCount / count);
              return (
                <OptionCard
                  key={count}
                  title={`${count} problem${count > 1 ? 's' : ''}/day`}
                  badge={count === options.recommendedDailyTarget ? 'Recommended' : undefined}
                  description={`${days} day${days > 1 ? 's' : ''} to finish ${plan.name} (${plan.problemCount} problems)`}
                  selected={dailyTarget === count}
                  onSelect={() => setDailyTarget(count)}
                />
              );
            })}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {prefillValid && plan && durationDays !== null && (
              <p className="rounded-lg border border-border-subtle bg-surface-100 px-3 py-2 text-sm text-zinc-400">
                {plan.name} · {dailyTarget} problem{dailyTarget === 1 ? '' : 's'}/day ·{' '}
                {durationDays} days. Just pick your deposit.
              </p>
            )}
            <div role="radiogroup" aria-label="Commitment amount" className="space-y-3">
              {options.depositAmounts.map((amount) => (
                <OptionCard
                  key={amount}
                  title={formatINR(amount)}
                  selected={depositAmount === amount}
                  onSelect={() => setDepositAmount(amount)}
                />
              ))}
            </div>
          </div>
        )}

        {step === 3 &&
          plan !== null &&
          dailyTarget !== null &&
          depositAmount !== null &&
          durationDays !== null &&
          totalProblems !== null && (
            <>
              <dl className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface-100 px-4">
                <Summary label="Plan" value={plan.name} />
                <Summary
                  label="Daily workload"
                  value={`${dailyTarget} problem${dailyTarget > 1 ? 's' : ''}/day`}
                />
                <Summary label="Duration" value={`${durationDays} days`} />
                <Summary label="Total problems" value={String(totalProblems)} />
                <Summary label="Deposit" value={formatINR(depositAmount)} />
              </dl>

              <div className="mt-6 space-y-3 text-sm leading-relaxed text-zinc-400">
                <p>
                  If you complete the challenge according to the rules, your eligible deposit will
                  be returned. If you miss commitments, the applicable forfeiture rules will apply.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    Each missed day forfeits {percent}% of your original deposit (
                    {formatINR((depositAmount * percent) / 100)}), up to 100%.
                  </li>
                  <li>
                    Each day must be completed before 11:59 PM in your timezone ({user?.timezone}).
                  </li>
                  <li>
                    Day 1 starts today, the moment payment activates your commitment — its deadline
                    is 11:59 PM tonight in your timezone. If less than a few hours of today are left
                    when you pay, Day 1 starts tomorrow instead.
                  </li>
                  <li>These rules are locked in when you commit and never change afterwards.</li>
                </ul>
              </div>

              <p className="mt-6 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                This creates your commitment; you'll pay your deposit on the next screen to activate
                it.
              </p>
            </>
          )}
      </div>

      {needsLeetCode && step === STEP_TITLES.length - 1 && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-border-muted bg-surface-200 px-3 py-2 text-sm text-zinc-300"
        >
          This plan is verified through LeetCode. Connect and verify your account before you can
          start.{' '}
          <Link to="/settings" className="text-primary hover:underline">
            Connect LeetCode
          </Link>
        </p>
      )}

      {create.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-risk/40 bg-risk/10 px-3 py-2 text-sm text-risk"
        >
          {create.error.message}
        </p>
      )}

      <div className="mt-8 flex gap-3">
        {step > 0 ? (
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
        ) : (
          <Link
            to="/dashboard"
            className={buttonClasses({ variant: 'ghost', className: 'flex-1 sm:flex-none' })}
          >
            Cancel
          </Link>
        )}
        {step < STEP_TITLES.length - 1 ? (
          <Button
            className="flex-1 sm:flex-none"
            disabled={!canContinue}
            onClick={() => setStep(step + 1)}
          >
            Continue
          </Button>
        ) : (
          <Button
            className="flex-1 sm:flex-none"
            loading={create.isPending}
            disabled={needsLeetCode}
            onClick={submit}
          >
            Commit {depositAmount !== null ? formatINR(depositAmount) : ''}
          </Button>
        )}
      </div>
    </div>
  );
}

export function CommitmentNewPage() {
  const optionsQuery = useCommitmentOptions();
  const plansQuery = usePlans();
  const commitmentsQuery = useCommitments();

  const queries = [optionsQuery, plansQuery, commitmentsQuery];
  if (queries.some((q) => q.isPending)) return <LoadingState />;

  const failed = queries.find((q) => q.isError);
  if (failed || !optionsQuery.data || !plansQuery.data || !commitmentsQuery.data) {
    return (
      <ErrorState
        title="We couldn't load the commitment options"
        description={failed?.error?.message}
        action={<Button onClick={() => queries.forEach((q) => void q.refetch())}>Try again</Button>}
      />
    );
  }

  if (findOpenCommitment(commitmentsQuery.data)) {
    return (
      <ErrorState
        title="You already have an open commitment"
        description="Finish your current commitment before starting another."
        action={
          <Link to="/dashboard" className={buttonClasses()}>
            Go to dashboard
          </Link>
        }
      />
    );
  }

  return <Wizard options={optionsQuery.data} plans={plansQuery.data} />;
}
