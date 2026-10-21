import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayKeyFor,
  DEFAULT_TIMEZONE,
  endOfDay,
  isValidTimezone,
  resolveTimezone,
} from './localDate.js';

describe('localDate', () => {
  it('maps the same instant to different calendar days per timezone', () => {
    const instant = new Date('2030-01-11T20:00:00Z');
    expect(dayKeyFor(instant, 'Asia/Kolkata')).toBe('2030-01-12');
    expect(dayKeyFor(instant, 'UTC')).toBe('2030-01-11');
    expect(dayKeyFor(instant, 'America/New_York')).toBe('2030-01-11');
  });

  it('rolls over exactly at local midnight', () => {
    expect(dayKeyFor(new Date('2030-01-11T18:29:59Z'), 'Asia/Kolkata')).toBe('2030-01-11');
    expect(dayKeyFor(new Date('2030-01-11T18:30:00Z'), 'Asia/Kolkata')).toBe('2030-01-12');
  });

  it('adds calendar days across month and year boundaries', () => {
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01');
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01');
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28');
    expect(addDays('2030-01-11', 0)).toBe('2030-01-11');
  });

  it('computes the deadline as the last millisecond of the local day', () => {
    expect(endOfDay('2030-01-11', 'Asia/Kolkata').toISOString()).toBe('2030-01-11T18:29:59.999Z');
    expect(endOfDay('2030-01-11', 'UTC').toISOString()).toBe('2030-01-11T23:59:59.999Z');
  });

  it('validates and resolves timezones', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
    expect(resolveTimezone('Not/AZone')).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone('UTC')).toBe('UTC');
  });
});
