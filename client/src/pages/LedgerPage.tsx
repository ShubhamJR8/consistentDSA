import { ArrowLeft, ArrowDownLeft, ArrowUpRight, CircleDollarSign } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { buttonClasses } from '../components/buttonClasses';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/PageState';
import { useLedger } from '../hooks/useCommitments';
import type { LedgerTransaction } from '../types/commitment';
import { formatDateTime, formatINR } from '../utils/format';

const BackLink = ({ to }: { to: string }) => (
  <Link
    to={to}
    className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"
  >
    <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
  </Link>
);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-medium text-white">{value}</dd>
    </div>
  );
}

const TYPE_LABEL: Record<LedgerTransaction['type'], string> = {
  DEPOSIT: 'Deposit',
  FORFEITURE: 'Forfeited',
  REFUND: 'Refund',
};

function TransactionRow({ tx }: { tx: LedgerTransaction }) {
  const isOutgoing = tx.type === 'FORFEITURE';
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isOutgoing ? 'bg-risk/10 text-risk' : 'bg-protected/10 text-protected'
          }`}
        >
          {isOutgoing ? (
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDownLeft className="h-4 w-4" aria-hidden />
          )}
        </span>
        <div>
          <p className="font-medium text-white">{TYPE_LABEL[tx.type]}</p>
          <p className="text-sm text-zinc-500">{tx.reference}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`font-mono font-medium ${isOutgoing ? 'text-risk' : 'text-protected'}`}>
          {isOutgoing ? '-' : '+'}
          {formatINR(tx.amount)}
        </p>
        <p className="text-xs text-zinc-500">{formatDateTime(tx.createdAt)}</p>
      </div>
    </li>
  );
}

export function LedgerPage() {
  const { id = '' } = useParams();
  const ledgerQuery = useLedger(id);

  if (ledgerQuery.isPending) return <LoadingState />;

  if (ledgerQuery.isError || !ledgerQuery.data) {
    return (
      <ErrorState
        title="We couldn't load this commitment's ledger"
        description={ledgerQuery.error?.message}
        action={<Button onClick={() => void ledgerQuery.refetch()}>Try again</Button>}
      />
    );
  }

  const { commitment, transactions } = ledgerQuery.data;

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink to="/dashboard" />
      <h1 className="text-2xl font-semibold tracking-tight text-white">Ledger</h1>
      <p className="mt-1 text-zinc-400">
        {commitment.planName} · {commitment.durationDays}-day commitment
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-6 rounded-2xl border border-border-subtle bg-surface-100 p-6 sm:grid-cols-3">
        <Stat label="Original deposit" value={formatINR(commitment.depositAmount)} />
        <Stat label="Protected" value={formatINR(commitment.currentProtectedAmount)} />
        <Stat label="Forfeited" value={formatINR(commitment.currentForfeitedAmount)} />
      </dl>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-zinc-400">Transaction history</h2>
        {transactions.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-muted py-12 text-center">
            <CircleDollarSign className="h-6 w-6 text-zinc-600" aria-hidden />
            <p className="text-sm text-zinc-500">No transactions yet.</p>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border-subtle rounded-2xl border border-border-subtle bg-surface-100 px-4">
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </ul>
        )}
      </div>

      <Link
        to={`/commitment/${id}/today`}
        className={buttonClasses({ variant: 'ghost', className: 'mt-6' })}
      >
        Back to today
      </Link>
    </div>
  );
}
