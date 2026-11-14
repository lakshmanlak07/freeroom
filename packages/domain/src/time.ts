import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const CAMPUS_TZ = 'America/New_York';
export const SLOT_MINUTES = 15;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const SLOT_MS = SLOT_MINUTES * MINUTE_MS;

/** Half-open interval [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

/** a.start < b.end && b.start < a.end — back-to-back intervals do not overlap. */
export const overlaps = (a: Interval, b: Interval): boolean =>
  a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

/**
 * 15-min alignment on the UTC epoch. New York offsets are whole hours, so this is
 * identical to campus-local alignment.
 */
export const isSlotAligned = (d: Date): boolean => d.getTime() % SLOT_MS === 0;

export const durationMs = (iv: Interval): number => iv.end.getTime() - iv.start.getTime();

/** Real (absolute) hours — DST never changes the arithmetic. */
export const addHours = (d: Date, hours: number): Date => new Date(d.getTime() + hours * HOUR_MS);

/** Start instant of every 15-min slot in [start, end). */
export function enumerateSlots(iv: Interval): Date[] {
  if (!isSlotAligned(iv.start) || !isSlotAligned(iv.end) || durationMs(iv) <= 0) {
    throw new RangeError('interval must be non-empty and 15-minute aligned');
  }
  const slots: Date[] = [];
  for (let t = iv.start.getTime(); t < iv.end.getTime(); t += SLOT_MS) slots.push(new Date(t));
  return slots;
}

/**
 * Every 15-min slot an arbitrary interval touches (floor start, ceil end). Used for class
 * locks: a 9:05–9:55 class blocks 9:00–10:00, exactly the aligned reservations it overlaps.
 */
export function coveringSlots(iv: Interval): Date[] {
  const start = Math.floor(iv.start.getTime() / SLOT_MS) * SLOT_MS;
  const end = Math.ceil(iv.end.getTime() / SLOT_MS) * SLOT_MS;
  return enumerateSlots({ start: new Date(start), end: new Date(end) });
}

/** Campus calendar day (yyyy-MM-dd) for an instant. */
export const campusDay = (d: Date): string => formatInTimeZone(d, CAMPUS_TZ, 'yyyy-MM-dd');

export const formatCampus = (d: Date, pattern: string): string =>
  formatInTimeZone(d, CAMPUS_TZ, pattern);

/** Calendar arithmetic on yyyy-MM-dd strings (no time zone involved). */
export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 24 * HOUR_MS).toISOString().slice(0, 10);

/** UTC instant of campus midnight starting `day` (23h/25h days handled by the TZ db). */
export const campusDayStart = (day: string): Date => fromZonedTime(`${day}T00:00`, CAMPUS_TZ);

/** Campus days touched by [start, end). */
export function campusDaysOf(iv: Interval): string[] {
  const days: string[] = [];
  const last = campusDay(new Date(iv.end.getTime() - 1));
  for (let d = campusDay(iv.start); d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Campus wall-clock time ("2026-11-16T09:00") → UTC instant. */
export const campusLocalToUtc = (local: string): Date => fromZonedTime(local, CAMPUS_TZ);
