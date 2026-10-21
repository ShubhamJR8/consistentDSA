const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const formatINR = (amount: number): string => inr.format(amount);

export const greetingForHour = (hour: number): string => {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

/** Formats a YYYY-MM-DD calendar day without any timezone shifting. */
export const formatDayKey = (dayKey: string): string =>
  new Date(`${dayKey}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const formatDeadline = (iso: string, timezone: string): string =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
