import { formatINR } from '../../utils/format';

const TOTAL_DAYS = 30;
const COMPLETED_DAYS = 18;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`mt-1 font-mono text-xl font-medium ${tone ?? 'text-white'}`}>{value}</dd>
    </div>
  );
}

export function ExampleCommitment() {
  return (
    <section id="challenges" className="border-t border-border-subtle">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-sm font-medium text-primary">Example commitment</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            See your status at a glance.
          </h2>
          <p className="mt-4 text-zinc-400">
            One screen answers the only question that matters: what is my commitment status today?
          </p>
          <p className="mt-6 text-sm text-zinc-500">
            This is an illustrative example, not a promise. What you get back depends on the rules
            you accept before depositing and on completing your challenge.
          </p>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-surface-100 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-white">30-Day DSA Commitment</h3>
              <p className="mt-1 text-sm text-zinc-400">
                {formatINR(1000)} · 30 days · 3 problems/day
              </p>
            </div>
            <span className="rounded-full border border-border-muted px-2.5 py-0.5 text-xs text-zinc-400">
              Example
            </span>
          </div>

          <div className="mt-8">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-zinc-400">Progress</span>
              <span className="font-mono text-zinc-200">
                {COMPLETED_DAYS} / {TOTAL_DAYS} days
              </span>
            </div>
            <div
              className="mt-3 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-0.5"
              role="img"
              aria-label={`${COMPLETED_DAYS} of ${TOTAL_DAYS} days completed`}
            >
              {Array.from({ length: TOTAL_DAYS }, (_, i) => (
                <span
                  key={i}
                  className={`h-6 rounded-sm ${i < COMPLETED_DAYS ? 'bg-protected' : 'bg-surface-50'}`}
                />
              ))}
            </div>
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-border-subtle pt-6">
            <Stat label="Money committed" value={formatINR(1000)} />
            <Stat label="Potential refund" value={formatINR(1000)} />
            <Stat label="At risk" value={formatINR(400)} tone="text-warning" />
            <Stat label="Protected" value={formatINR(600)} tone="text-protected" />
          </dl>
        </div>
      </div>
    </section>
  );
}
