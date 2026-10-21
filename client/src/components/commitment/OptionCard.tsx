import { cn } from '../../utils/cn';

interface OptionCardProps {
  title: string;
  description?: string;
  badge?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function OptionCard({
  title,
  description,
  badge,
  selected,
  disabled,
  onSelect,
}: OptionCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border-muted bg-surface-200 hover:bg-surface-100',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-surface-200'
      )}
    >
      <span>
        <span className="block font-medium text-white">{title}</span>
        {description && <span className="mt-0.5 block text-sm text-zinc-400">{description}</span>}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full border border-border-muted px-2 py-0.5 text-xs text-zinc-300">
          {badge}
        </span>
      )}
    </button>
  );
}
