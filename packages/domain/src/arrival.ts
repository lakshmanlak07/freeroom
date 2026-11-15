/**
 * "Will it still be free when I get there?" — a pure verdict for the directions panel.
 * Time is injected (arriveAt); the campus day is 07:00–23:00 New York time, like the timeline.
 */
import { addDays, campusDay, campusLocalToUtc, MINUTE_MS, SLOT_MS, type Interval } from './time';

export const CLASS_SOON_MINUTES = 30;
const DAY_START = '07:00';
const DAY_END = '23:00';

export type ScheduleBlock =
  | (Interval & { kind: 'class'; name: string })
  | (Interval & { kind: 'reservation'; isMine: boolean });

export type ArrivalVerdict =
  | { kind: 'FREE_FOR'; minutes: number; until: Date }
  | { kind: 'CLASS_STARTS_SOON'; className: string; inMinutes: number; startsAt: Date }
  | { kind: 'BUSY_UNTIL'; until: Date; closed?: true }
  | { kind: 'YOURS'; until: Date };

/** Round up to the next 15-minute slot (exact boundaries stay). UTC-aligned = campus-aligned. */
export const ceilToSlot = (d: Date): Date => new Date(Math.ceil(d.getTime() / SLOT_MS) * SLOT_MS);

export function arrivalVerdict(arriveAt: Date, blocks: readonly ScheduleBlock[]): ArrivalVerdict {
  const t = arriveAt.getTime();
  const day = campusDay(arriveAt);
  const open = campusLocalToUtc(`${day}T${DAY_START}`);
  const close = campusLocalToUtc(`${day}T${DAY_END}`);
  if (t < open.getTime()) return { kind: 'BUSY_UNTIL', until: open, closed: true };
  if (t >= close.getTime()) {
    return {
      kind: 'BUSY_UNTIL',
      until: campusLocalToUtc(`${addDays(day, 1)}T${DAY_START}`),
      closed: true,
    };
  }

  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const current = sorted.find((b) => b.start.getTime() <= t && t < b.end.getTime());
  if (current) {
    if (current.kind === 'reservation' && current.isMine) {
      return { kind: 'YOURS', until: current.end };
    }
    // Busy until the end of the run of back-to-back (or overlapping) blocks.
    let until = current.end.getTime();
    for (const b of sorted) {
      if (b.start.getTime() <= until && b.end.getTime() > until) until = b.end.getTime();
    }
    return { kind: 'BUSY_UNTIL', until: new Date(until) };
  }

  const next = sorted.find((b) => b.start.getTime() > t && b.start.getTime() < close.getTime());
  const until = next ? next.start : close;
  const minutes = Math.floor((until.getTime() - t) / MINUTE_MS);
  if (next?.kind === 'class' && minutes < CLASS_SOON_MINUTES) {
    return {
      kind: 'CLASS_STARTS_SOON',
      className: next.name,
      inMinutes: minutes,
      startsAt: next.start,
    };
  }
  return { kind: 'FREE_FOR', minutes, until };
}
