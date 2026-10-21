const faqs = [
  {
    q: 'What happens if I miss a day?',
    a: 'Each missed day forfeits 10% of your original deposit, up to 100%. The exact rules are shown before you pay, and they are locked in when your commitment starts.',
  },
  {
    q: 'When do I get my money back?',
    a: 'After your final day, we calculate your eligible refund on the server: your deposit minus any forfeitures. You then request the refund from your commitment page.',
  },
  {
    q: 'Is this a bet?',
    a: 'No. You are not competing against anyone and there is no prize. The most you can ever get back is your own deposit. This is a personal commitment mechanism.',
  },
  {
    q: 'Can I stop a commitment?',
    a: 'Cancellation and early-exit terms will be stated in full before you deposit. Once a commitment is active, its rules cannot be changed.',
  },
  {
    q: 'How is completion verified?',
    a: 'For now, completion is self-reported: you check off each problem yourself, and the server records it and decides whether the day counts. Stronger verification is planned.',
  },
  {
    q: 'What happens to forfeited money?',
    a: 'The forfeiture policy will be published in the Terms before you make any deposit. No fees are hidden, and the rules never change after your commitment starts.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="border-t border-border-subtle">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <p className="text-sm font-medium text-primary">FAQ</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Questions, answered plainly.
        </h2>
        <div className="mt-10 divide-y divide-border-subtle border-y border-border-subtle">
          {faqs.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-medium text-white [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  aria-hidden
                  className="text-xl text-zinc-500 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-2 pr-8 text-sm leading-relaxed text-zinc-400">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
