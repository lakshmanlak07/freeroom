/** Pure helpers for the "Get me there" panel (unit-tested). */
import { ceilToSlot, SLOT_MS } from '@freeroom/domain';
import type { Arrival, RouteResponse } from '@freeroom/shared';
import { fmtTime } from '@/lib/time';

/** "6 min walk" (never "0 min"). */
export const fmtWalk = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min walk`;

/** US campus: feet under ~0.1 mi, otherwise miles with one decimal. */
export function fmtDistance(meters: number) {
  const feet = meters * 3.28084;
  if (feet < 528) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

const hm = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m} min`;
};

export type Tone = 'free' | 'soon' | 'busy' | 'mine';

/** Verdict → tone + one short sentence (the icon comes from the tone; text never relies on color). */
export function verdict(a: Arrival): { tone: Tone; text: string } {
  switch (a.kind) {
    case 'FREE_FOR':
      return { tone: 'free', text: `Free for ${hm(a.minutes)} after you arrive` };
    case 'CLASS_STARTS_SOON':
      return { tone: 'soon', text: `${a.className} starts ${a.inMinutes} min after you arrive` };
    case 'BUSY_UNTIL':
      return {
        tone: 'busy',
        text: `${a.closed ? 'Closed' : 'Busy'} until ${fmtTime(new Date(a.until))}`,
      };
    case 'YOURS':
      return { tone: 'mine', text: `It’s yours until ${fmtTime(new Date(a.until))}` };
  }
}

/**
 * "Reserve it for when I arrive": start = arrival rounded up to the next 15-min slot; end = an hour
 * later, cut at the next booking. null when not even one whole slot is left.
 */
export function reservePrefill(r: Pick<RouteResponse, 'arriveAt' | 'arrival'>) {
  const a = r.arrival;
  if (a.kind !== 'FREE_FOR' && a.kind !== 'CLASS_STARTS_SOON') return null;
  const start = ceilToSlot(new Date(r.arriveAt));
  const limit = new Date(a.kind === 'FREE_FOR' ? a.until : a.startsAt).getTime();
  const end = Math.min(start.getTime() + 4 * SLOT_MS, Math.floor(limit / SLOT_MS) * SLOT_MS);
  return end > start.getTime() ? { start, end: new Date(end) } : null;
}
