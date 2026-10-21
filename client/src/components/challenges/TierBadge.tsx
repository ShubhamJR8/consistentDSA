import { cn } from '../../utils/cn';
import type { PlanLevel } from '../../types/commitment';

// Tier colors reuse the app's existing semantic palette (protected/warning/risk) instead of
// introducing new "game" colors — a Basic track reads as low-risk, Advanced as high-stakes.
const TIER_STYLES: Record<PlanLevel, string> = {
  Basic: 'border-protected/40 text-protected',
  Medium: 'border-warning/40 text-warning',
  Advanced: 'border-risk/40 text-risk',
};

export function TierBadge({ level, className }: { level: PlanLevel | null; className?: string }) {
  const label = level ?? 'Full Track';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.2em]',
        level ? TIER_STYLES[level] : 'border-primary/40 text-primary',
        className
      )}
    >
      <span aria-hidden>▸</span>
      {label}
    </span>
  );
}
