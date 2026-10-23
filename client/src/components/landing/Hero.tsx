import { Link } from 'react-router-dom';
import { buttonClasses } from '../buttonClasses';
import { useCtaTarget } from '../../hooks/useCtaTarget';

export function Hero() {
  const ctaTo = useCtaTarget();

  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pb-28 sm:pt-28">
      <p className="mx-auto inline-block rounded-full border border-border-subtle px-3 py-1 text-xs text-zinc-400">
        Private accountability for developers who are serious about getting better.
      </p>
      <h1 className="mt-6 text-3xl font-extrabold leading-tight tracking-tight [text-wrap:balance] sm:text-5xl lg:text-6xl">
        <span className="block text-white">The curse of discipline is that every day looks the same.</span>
        <span className="mt-4 block font-bold text-zinc-500">
          The curse of indiscipline is that every year looks same.
        </span>
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
