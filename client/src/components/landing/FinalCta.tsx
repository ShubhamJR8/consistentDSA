import { Link } from 'react-router-dom';
import { buttonClasses } from '../buttonClasses';
import { useCtaTarget } from '../../hooks/useCtaTarget';

export function FinalCta() {
  const ctaTo = useCtaTarget();

  return (
    <section className="border-t border-border-subtle">
      <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-white">
          Ready to make your commitment?
        </h2>
        <div className="mt-8 flex justify-center">
          <Link to={ctaTo} className={buttonClasses({ size: 'lg' })}>
            Start My Commitment
          </Link>
        </div>
      </div>
    </section>
  );
}
