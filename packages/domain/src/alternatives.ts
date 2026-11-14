import { overlaps, type Interval } from './time';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoomCandidate extends LatLng {
  roomId: string;
  buildingId: string;
  capacity: number;
  /** Classes + active reservations near the window. */
  busy: readonly Interval[];
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * BR-9: up to `limit` free rooms for the same window: same building first, then nearest,
 * capacity ≥ party size. Ties break by smallest fitting capacity, then roomId (deterministic).
 */
export function findAlternatives(
  origin: LatLng & { roomId: string; buildingId: string; window: Interval; partySize: number },
  candidates: readonly RoomCandidate[],
  limit = 3,
): RoomCandidate[] {
  const key = (r: RoomCandidate) => ({
    other: r.buildingId === origin.buildingId ? 0 : 1,
    dist: distanceMeters(origin, r),
  });
  return candidates
    .filter(
      (r) =>
        r.roomId !== origin.roomId &&
        r.capacity >= origin.partySize &&
        !r.busy.some((b) => overlaps(b, origin.window)),
    )
    .map((r) => ({ r, k: key(r) }))
    .sort(
      (a, b) =>
        a.k.other - b.k.other ||
        a.k.dist - b.k.dist ||
        a.r.capacity - b.r.capacity ||
        a.r.roomId.localeCompare(b.r.roomId),
    )
    .slice(0, limit)
    .map(({ r }) => r);
}
