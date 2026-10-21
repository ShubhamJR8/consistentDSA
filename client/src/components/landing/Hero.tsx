import { Link } from 'react-router-dom';
import { buttonClasses } from '../buttonClasses';
import { useCtaTarget } from '../../hooks/useCtaTarget';

export function Hero() {
  const ctaTo = useCtaTarget();

  return (
    <section className="mx-auto max-w-4xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pb-28 sm:pt-28">
      <p className="mx-auto inline-block rounded-full border border-border-subtle px-3 py-1 text-xs text-zinc-400">
        Private accountability for developers who are serious about getting better.
      </p>
      <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
        Your DSA streak has a price.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
        Commit money. Show up every day. Get your eligible deposit back when you finish.
      </p>
      <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <Link to={ctaTo} className={buttonClasses({ size: 'lg' })}>
          Start My Commitment
        </Link>
        <Link to="/#how-it-works" className={buttonClasses({ variant: 'secondary', size: 'lg' })}>
          See How It Works
        </Link>
      </div>
    </section>
  );
}
