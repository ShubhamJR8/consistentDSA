const steps = [
  {
    stage: 'Commit',
    title: 'Choose your commitment',
    body: 'Pick a duration, a daily workload and a DSA plan that fits how you actually work.',
  },
  {
    stage: 'Commit',
    title: 'Deposit money',
    body: 'Put your own money behind the plan. The rules are shown in full before you pay.',
  },
  {
    stage: 'Practice',
    title: 'Solve your daily DSA problems',
    body: 'Each day you get a short, defined list of problems. Finish it before the daily deadline.',
  },
  {
    stage: 'Maintain',
    title: 'Maintain your streak',
    body: 'Your streak, progress and amount at risk are always visible on one screen.',
  },
  {
    stage: 'Finish',
    title: 'Finish the challenge',
    body: 'On the final day the server evaluates your commitment against the rules you accepted.',
  },
  {
    stage: 'Finish',
    title: 'Get your eligible money back',
    body: 'Your deposit minus any forfeitures is returned. Every transaction is in your ledger.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border-subtle">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="text-sm font-medium text-primary">How it works</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Commit → Practice → Maintain → Finish
        </h2>
        <ol className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border-muted font-mono text-sm text-zinc-300">
                  {index + 1}
                </span>
                <span className="text-xs uppercase tracking-wider text-zinc-500">{step.stage}</span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
