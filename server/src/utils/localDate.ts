import { DateTime, IANAZone } from 'luxon';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export const isValidTimezone = (timezone: string): boolean => IANAZone.isValidZone(timezone);

export const resolveTimezone = (timezone: string | null | undefined): string =>
  timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;

/** The calendar day (YYYY-MM-DD) that `instant` falls on in `timezone`. */
export const dayKeyFor = (instant: Date, timezone: string): string =>
  DateTime.fromJSDate(instant, { zone: timezone }).toISODate()!;

/** Calendar-day arithmetic on YYYY-MM-DD keys; independent of any timezone or DST. */
export const addDays = (dayKey: string, days: number): string =>
  DateTime.fromISO(dayKey, { zone: 'utc' }).plus({ days }).toISODate()!;

/** The last instant (23:59:59.999) of a calendar day in `timezone`. */
export const endOfDay = (dayKey: string, timezone: string): Date =>
  DateTime.fromISO(dayKey, { zone: timezone }).endOf('day').toJSDate();

/** The first instant (00:00:00.000) of a calendar day in `timezone`. */
export const startOfDay = (dayKey: string, timezone: string): Date =>
  DateTime.fromISO(dayKey, { zone: timezone }).startOf('day').toJSDate();

/** Whole-and-fractional hours left in the calendar day that `instant` falls on in `timezone`. */
export const hoursLeftInDay = (instant: Date, timezone: string): number =>
  (endOfDay(dayKeyFor(instant, timezone), timezone).getTime() - instant.getTime()) / 3_600_000;
