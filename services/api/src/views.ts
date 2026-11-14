/** Response projections. Allowlist-only so no PII can ride along (BR-5). */
import { toReservationItem, type PublicUser } from '@freeroom/domain';
import type { ClassItem, ReservationDetail, Room } from '@freeroom/shared';
import type { CatalogRoom } from './data/catalog';
import { asInterval, type ReservationRecord } from './data/reservations';
import type { StoredClass } from './data/schedule';

export const UNKNOWN_OWNER: PublicUser = { displayAlias: 'A FreeRoom user', role: 'STUDENT' };

export const publicRoom = (r: CatalogRoom): Room => ({
  roomId: r.roomId,
  buildingId: r.buildingId,
  buildingName: r.buildingName,
  name: r.name,
  capacity: r.capacity,
  equipment: r.equipment,
  lat: r.lat,
  lng: r.lng,
});

export const reservationItem = (
  rec: ReservationRecord,
  owner: PublicUser,
  viewerId: string,
  now: Date,
) => toReservationItem({ ...rec, ...asInterval(rec) }, owner, viewerId, now);

export function reservationDetail(
  rec: ReservationRecord,
  owner: PublicUser,
  viewerId: string,
  now: Date,
): ReservationDetail {
  const item = reservationItem(rec, owner, viewerId, now);
  return {
    id: item.id,
    roomId: item.roomId,
    start: item.start,
    end: item.end,
    status: item.status,
    ownerAlias: item.ownerAlias,
    isMine: item.isMine,
    claimable: item.claimable,
    partySize: rec.partySize,
    ...(rec.purpose ? { purpose: rec.purpose } : {}),
    cutoffAt: rec.cutoffAt,
    confirmedAt: rec.confirmedAt,
    createdAt: rec.createdAt,
    releaseReason: rec.releaseReason,
  };
}

/** BR-3: everything 25Live gives us for the tooltip. */
export const classItem = (c: StoredClass, room: CatalogRoom): ClassItem => ({
  kind: 'class',
  eventId: c.eventId,
  name: c.name,
  ...(c.courseCode ? { courseCode: c.courseCode } : {}),
  ...(c.section ? { section: c.section } : {}),
  ...(c.eventType ? { eventType: c.eventType } : {}),
  ...(c.organization ? { organization: c.organization } : {}),
  start: c.start.toISOString(),
  end: c.end.toISOString(),
  roomId: room.roomId,
  roomName: room.name,
  buildingName: room.buildingName,
});
