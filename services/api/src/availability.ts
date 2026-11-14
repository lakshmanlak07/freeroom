/** Room busy-ness for search/status chips (F1). */
import {
  ACTIVE_RESERVATION_STATUSES,
  addDays,
  isClaimable,
  overlaps,
  type ClassEvent,
  type Interval,
} from '@freeroom/domain';
import type { RoomStatus } from '@freeroom/shared';
import { mapLimit, type Db } from './data/db';
import { asInterval, listRoomReservations, type ReservationRecord } from './data/reservations';
import { getRoomDay } from './data/schedule';

export interface Busy {
  classes: ClassEvent[];
  reservations: ReservationRecord[]; // active only
}

// ponytail: per-room queries cached 10s (matches web polling). Upgrade path: the AVAIL#{building}
// projection maintained by the stream processor (PRD AP11) once P3's stream lands.
const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; value: Promise<Busy> }>();

async function loadRoom(db: Db, roomId: string, days: readonly string[]): Promise<Busy> {
  const [dayData, reservations] = await Promise.all([
    Promise.all(days.map((d) => getRoomDay(db, roomId, d))),
    listRoomReservations(db, roomId, [addDays(days[0]!, -1), ...days]), // previous day may spill over
  ]);
  return {
    classes: dayData.flatMap((d) => d.classes),
    reservations: reservations.filter((r) => ACTIVE_RESERVATION_STATUSES.includes(r.status)),
  };
}

export async function loadBusy(
  db: Db,
  roomIds: readonly string[],
  days: readonly string[],
  nowMs: number,
) {
  const entries = await mapLimit(roomIds, 16, async (roomId) => {
    const key = `${db.table}|${roomId}|${days.join(',')}`;
    let hit = cache.get(key);
    if (!hit || nowMs - hit.at >= CACHE_MS) {
      hit = { at: nowMs, value: loadRoom(db, roomId, days) };
      cache.set(key, hit);
      hit.value.catch(() => cache.delete(key));
    }
    return [roomId, await hit.value] as const;
  });
  return new Map(entries);
}

export const clearBusyCache = () => cache.clear();

const intervals = (b: Busy) => [...b.classes, ...b.reservations.map(asInterval)];

export const isFreeDuring = (b: Busy, iv: Interval) => !intervals(b).some((x) => overlaps(x, iv));

/** Status chip at instant `t`; freeUntil = next busy start (or end of campus day). */
export function statusAt(
  b: Busy,
  t: Date,
  now: Date,
  dayEnd: Date,
): { status: RoomStatus; freeUntil: string | null } {
  const at = { start: t, end: new Date(t.getTime() + 1) };
  if (b.classes.some((c) => overlaps(c, at)))
    return { status: 'CLASS_IN_PROGRESS', freeUntil: null };
  const res = b.reservations.find((r) => overlaps(asInterval(r), at));
  if (res) {
    const claimable = isClaimable({ status: res.status, start: new Date(res.start) }, now);
    return { status: claimable ? 'RESERVED_CLAIMABLE' : 'RESERVED', freeUntil: null };
  }
  const next = intervals(b)
    .map((x) => x.start.getTime())
    .filter((s) => s > t.getTime())
    .sort((x, y) => x - y)[0];
  return {
    status: 'FREE',
    freeUntil: new Date(Math.min(next ?? Infinity, dayEnd.getTime())).toISOString(),
  };
}
