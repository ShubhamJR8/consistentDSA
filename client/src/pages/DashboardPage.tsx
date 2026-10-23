import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { buttonClasses } from '../components/buttonClasses';
import { ProgressCalendar } from '../components/commitment/ProgressCalendar';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { useAuth } from '../hooks/useAuth';
import {
  useCancelCommitment,
  useCommitments,
  useCreatePaymentOrder,
  useDevActivate,
  useProgress,
  useToday,
  useVerifyPayment,
} from '../hooks/useCommitments';
import { authService } from '../services/auth.service';
import type { Commitment } from '../types/commitment';
import { findOpenCommitment, todayMessage } from '../utils/commitment';
import { formatDayKey, formatINR, greetingForHour } from '../utils/format';
import { openRazorpayCheckout } from '../utils/razorpay';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-medium text-white">{value}</dd>
    </div>
  );
}

function CommitmentHeader({ commitment, badge }: { commitment: Commitment; badge: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-white">
          {commitment.durationDays}-Day DSA Commitment
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {commitment.planName} · {commitment.dailyTarget} problem
          {commitment.dailyTarget > 1 ? 's' : ''}/day
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-border-muted px-2.5 py-0.5 text-xs text-zinc-300">
        {badge}
      </span>
    </div>
  );
}

function VerifyEmailNotice() {
  const resend = useMutation({ mutationFn: authService.resendVerification });
  return (
    <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
      <p>Verify your email before paying your deposit — this is how we&apos;ll reach you about your refund.</p>
      <button
        type="button"
        className="mt-2 font-medium underline-offset-4 hover:underline disabled:no-underline disabled:opacity-70"
        disabled={resend.isPending || resend.isSuccess}
        onClick={() => resend.mutate()}
      >
        {resend.isSuccess ? 'Verification email sent — check your inbox' : 'Resend verification email'}
      </button>
    </div>
  );
}

function PendingPaymentPanel({ commitment }: { commitment: Commitment }) {
  const { user } = useAuth();
  const activate = useDevActivate();
  const createOrder = useCreatePaymentOrder();
  const verifyPayment = useVerifyPayment(commitment.id);
  const cancel = useCancelCommitment(commitment.id);
  // Covers the stretch between the checkout popup opening and it calling us back — neither
  // mutation is "pending" during that window, since we're waiting on the user, not the network.
  const [awaitingCheckout, setAwaitingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const emailVerified = user?.emailVerified ?? false;

  const pay = async () => {
    setCheckoutError(null);
    try {
      const order = await createOrder.mutateAsync(commitment.id);
      setAwaitingCheckout(true);
      await openRazorpayCheckout({
        keyId: order.keyId,
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        onSuccess: (result) => {
          setAwaitingCheckout(false);
          verifyPayment.mutate({
            razorpayOrderId: result.razorpay_order_id,
            razorpayPaymentId: result.razorpay_payment_id,
            razorpaySignature: result.razorpay_signature,
          });
        },
        onDismiss: () => setAwaitingCheckout(false),
      });
    } catch (error) {
      setAwaitingCheckout(false);
      setCheckoutError(error instanceof Error ? error.message : 'Could not open Razorpay.');
    }
  };

  const error =
    checkoutError ??
    createOrder.error?.message ??
    verifyPayment.error?.message ??
    cancel.error?.message;

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-100 p-6">
      <CommitmentHeader commitment={commitment} badge="Awaiting payment" />
      <dl className="mt-6">
        <Stat label="Money committed" value={formatINR(commitment.depositAmount)} />
      </dl>
      <p className="mt-6 text-sm text-zinc-400">
        Your commitment is created but not active yet. Pay your deposit to lock it in — Day 1 starts
        today, right after payment, with its deadline at 11:59 PM tonight in your timezone.
      </p>

      {!emailVerified && <VerifyEmailNotice />}

      <div className="mt-4">
        <Button
          loading={createOrder.isPending || awaitingCheckout || verifyPayment.isPending}
          disabled={!emailVerified}
          onClick={pay}
        >
          Pay {formatINR(commitment.depositAmount)} &amp; activate
        </Button>
        <button
          type="button"
          className="ml-4 text-sm text-zinc-400 underline hover:text-zinc-200 disabled:opacity-50"
          disabled={cancel.isPending || createOrder.isPending || awaitingCheckout}
          onClick={() => {
            if (window.confirm('Cancel this commitment? A payment still in progress will be refunded.')) cancel.mutate();
          }}
        >
          Cancel commitment
        </button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-risk">
            {error}
          </p>
        )}
      </div>

      {import.meta.env.DEV && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          <Button
            variant="secondary"
            loading={activate.isPending}
            onClick={() => activate.mutate(commitment.id)}
          >
            Activate without paying (development only)
          </Button>
          {activate.error && (
            <p role="alert" className="mt-3 text-sm text-risk">
              {activate.error.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ActivePanel({ commitment }: { commitment: Commitment }) {
  const todayQuery = useToday(commitment.id);
  const progressQuery = useProgress(commitment.id);

  if (todayQuery.isPending || progressQuery.isPending) return <LoadingState />;
  if (todayQuery.isError || progressQuery.isError || !todayQuery.data || !progressQuery.data) {
    return (
      <ErrorState
        title="We couldn't load your commitment"
        description={(todayQuery.error ?? progressQuery.error)?.message}
        action={
          <Button
            onClick={() => {
              void todayQuery.refetch();
              void progressQuery.refetch();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const { phase, today } = todayQuery.data;
  const live = progressQuery.data.commitment;
  const totalCompleted = progressQuery.data.days.reduce((sum, d) => sum + d.completedProblems, 0);

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-100 p-6">
      <CommitmentHeader
        commitment={live}
        badge={
          phase === 'IN_PROGRESS' && today
            ? `Day ${today.dayNumber} / ${live.durationDays}`
            : 'Active'
        }
      />

      {phase === 'NOT_STARTED' && live.startDate && (
        <p className="mt-6 text-zinc-300">
          Your commitment starts on {formatDayKey(live.startDate)}.
        </p>
      )}

      {phase === 'ENDED' && (
        <p className="mt-6 text-zinc-300">
          Your challenge period has ended. Final evaluation and refunds arrive in the next phase.
        </p>
      )}

      {phase === 'IN_PROGRESS' && today && (
        <div className="mt-6">
          <p
            className={`text-base ${today.status === 'COMPLETED' ? 'text-protected' : 'text-white'}`}
          >
            {todayMessage(today)}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Today's commitment" value={`${today.requiredProblems} problems`} />
            <Stat
              label="Completed today"
              value={`${today.completedProblems} / ${today.requiredProblems}`}
            />
            <Stat label="Plan progress" value={`${totalCompleted} / ${live.totalProblems}`} />
            <Stat label="Money committed" value={formatINR(live.depositAmount)} />
          </dl>
          {today.status !== 'COMPLETED' && (
            <Link
              to={`/commitment/${live.id}/today`}
              className={buttonClasses({ size: 'lg', className: 'mt-6 w-full sm:w-auto' })}
            >
              {today.completedProblems === 0
                ? 'Start today’s commitment'
                : 'Finish today’s commitment'}
            </Link>
          )}
        </div>
      )}

      <div className="mt-8 border-t border-border-subtle pt-6">
        <ProgressCalendar days={progressQuery.data.days} />
      </div>

      <div className="mt-6 flex gap-5">
        <Link to={`/commitment/${live.id}/plan`} className="text-sm text-zinc-400 hover:text-white">
          View full plan →
        </Link>
        <Link
          to={`/commitment/${live.id}/ledger`}
          className="text-sm text-zinc-400 hover:text-white"
        >
          View ledger →
        </Link>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const commitmentsQuery = useCommitments();
  const firstName = user?.name.split(' ')[0] ?? '';
  const open = commitmentsQuery.data ? findOpenCommitment(commitmentsQuery.data) : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        {greetingForHour(new Date().getHours())}, {firstName}.
      </h1>
      <p className="mt-1 text-zinc-400">Here is your commitment status today.</p>

      <div className="mt-8">
        {commitmentsQuery.isPending ? (
          <LoadingState />
        ) : commitmentsQuery.isError ? (
          <ErrorState
            title="We couldn't load your commitments"
            description={commitmentsQuery.error.message}
            action={<Button onClick={() => void commitmentsQuery.refetch()}>Try again</Button>}
          />
        ) : !open ? (
          <EmptyState
            title="You don't have an active commitment."
            description="Choose a duration, a daily workload and a DSA plan, then put money behind it."
            action={
              <Link to="/commitment/new" className={buttonClasses()}>
                Create a Commitment
              </Link>
            }
          />
        ) : open.status === 'PENDING_PAYMENT' ? (
          <PendingPaymentPanel commitment={open} />
        ) : (
          <ActivePanel commitment={open} />
        )}
      </div>
    </>
  );
}
