import { cn } from '../../utils/cn';
import type { PlanSummary } from '../../types/commitment';
import { TierBadge } from './TierBadge';

interface ChallengeCardProps {
  plan: PlanSummary;
  /** Eyebrow tag, e.g. "CH.01" for a chapter, "TR.02" for a tier track, "★ FEATURED". */
  label: string;
  accent?: boolean;
  selected: boolean;
  onSelect: () => void;
}

export function ChallengeCard({ plan, label, accent, selected, onSelect }: ChallengeCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'group w-full rounded-xl border bg-surface-200 px-5 py-4 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border-subtle hover:border-border-muted hover:bg-surface-100'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            'font-mono text-[11px] tracking-[0.2em]',
            accent ? 'text-primary' : 'text-zinc-600'
          )}
        >
          {label}
        </span>
        <TierBadge level={plan.level} />
      </div>

      <h3 className="mt-3 text-base font-semibold text-white">{plan.name}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{plan.description}</p>

      <div className="mt-4 flex items-baseline gap-1.5 font-mono">
        <span className="text-lg font-semibold text-white">{plan.problemCount}</span>
        <span className="text-[11px] uppercase tracking-widest text-zinc-500">problems</span>
      </div>
    </button>
  );
}
