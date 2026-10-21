import { Check, X } from 'lucide-react';
import type { ProgressDay } from '../../types/commitment';
import { cn } from '../../utils/cn';

type CellState = 'completed' | 'missed' | 'today' | 'upcoming';

const stateOf = (day: ProgressDay): CellState => {
  if (day.status === 'COMPLETED') return 'completed';
  if (day.status === 'MISSED') return 'missed';
  return day.isToday ? 'today' : 'upcoming';
};

const LABELS: Record<CellState, string> = {
  completed: 'Completed',
  missed: 'Missed',
  today: 'Today',
  upcoming: 'Upcoming',
};

const CELL_STYLES: Record<CellState, string> = {
  completed: 'border-protected/50 bg-protected/15 text-protected',
  missed: 'border-risk/50 bg-risk/10 text-risk',
  today: 'border-primary bg-primary/15 text-white',
  upcoming: 'border-border-subtle text-zinc-500',
};

const SWATCH_STYLES: Record<CellState, string> = {
  completed: 'bg-protected/40',
  missed: 'bg-risk/40',
  today: 'bg-primary',
  upcoming: 'bg-surface-50',
};

export function ProgressCalendar({ days }: { days: ProgressDay[] }) {
  return (
    <div>
      <ol className="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
        {days.map((day) => {
          const state = stateOf(day);
          return (
            <li
              key={day.date}
              title={`Day ${day.dayNumber} · ${LABELS[state]}`}
              aria-label={`Day ${day.dayNumber}: ${LABELS[state]}`}
              className={cn(
                'flex h-11 items-center justify-center rounded-lg border text-sm font-medium tabular-nums',
                CELL_STYLES[state]
              )}
            >
              {state === 'completed' ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : state === 'missed' ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                day.dayNumber
              )}
            </li>
          );
        })}
      </ol>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-400">
        {(Object.keys(LABELS) as CellState[]).map((state) => (
          <li key={state} className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 rounded-sm', SWATCH_STYLES[state])} aria-hidden />
            {LABELS[state]}
          </li>
        ))}
      </ul>
    </div>
  );
}
