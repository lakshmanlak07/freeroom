/** Campus-time helpers for the UI. All math is on real instants; display is America/New_York. */
import { addDays, campusDay, campusLocalToUtc, formatCampus } from '@freeroom/domain';
import { useEffect, useState } from 'react';

export { addDays, campusDay, campusLocalToUtc, formatCampus };

export const fmtTime = (d: Date | string) => formatCampus(new Date(d), 'h:mm a');
export const fmtRange = (a: Date | string, b: Date | string) => `${fmtTime(a)} – ${fmtTime(b)}`;
export const fmtDay = (day: string) =>
  formatCampus(campusLocalToUtc(`${day}T12:00`), 'EEEE, MMM d');

/** "2h 14m", "45m", "under a minute". */
export function fmtDuration(ms: number) {
  if (ms < 60_000) return 'under a minute';
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Re-render on an interval so countdowns and the now-line move. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "Free until 3:15 PM" / "Free for the rest of the day". */
export function freeUntilLabel(freeUntil: string | null) {
  if (!freeUntil) return 'Free';
  const d = new Date(freeUntil);
  return formatCampus(d, 'HH:mm') === '00:00'
    ? 'Free for the rest of the day'
    : `Free until ${fmtTime(d)}`;
}

/** URL params are user-editable: only well-formed values reach date math (audit L3). */
export const isDay = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && !Number.isNaN(Date.parse(s));
export const isHm = (s: string | null | undefined): s is string =>
  !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
