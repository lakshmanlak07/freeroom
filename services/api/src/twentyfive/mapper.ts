/**
 * ALL 25Live field names and endpoint paths live here (CLAUDE.md). Shapes follow the 25Live
 * REST web services (r25ws) JSON output as documented publicly.
 * TODO(25live): verify every field marked TODO against our instance once UMass IT grants access.
 */
import type { ClassEvent } from '@freeroom/domain';
import type { Equipment } from '@freeroom/shared';
import { CAMPUS_BUILDINGS } from './campus';
import type { SourceRoom } from './source';

// TODO(25live): confirm paths (instance-specific prefix, e.g. /r25ws/wrd/<instance>/run).
export const PATHS = {
  spaces: '/spaces.json',
  reservations: '/reservations.json',
} as const;

export interface RawSpace {
  space_id: number;
  space_name: string; // e.g. "LGRT 0101" — TODO(25live): confirm naming convention
  formal_name?: string;
  max_capacity: number; // TODO(25live): may be "max_capacity" or layouts[].capacity
  building_code?: string; // TODO(25live): custom attribute? fallback = first token of space_name
  features?: { feature_name: string }[];
}

export interface RawReservation {
  reservation_id: number;
  reservation_start_dt: string; // ISO-8601 with offset, e.g. 2026-11-16T09:05:00-05:00
  reservation_end_dt: string;
  space_id: number; // TODO(25live): real payload nests this under space_reservation.space
  event: {
    event_id: number;
    event_name: string; // e.g. "COMPSCI 220-01: Programming Methodology"
    event_type_name?: string; // TODO(25live): confirm (Lecture/Discussion/Lab)
    organization_name?: string; // TODO(25live): may be event.organization.organization_name
  };
}

// TODO(25live): confirm the top-level wrappers.
export const unwrapSpaces = (json: unknown): RawSpace[] =>
  ((json as { spaces?: { space?: RawSpace[] } }).spaces?.space ?? []) as RawSpace[];
/**
 * Audit H3: a payload without the `reservations` wrapper is an error, not "no classes" — treating
 * it as empty would make the sync delete every cached class (and its locks) for those room-days.
 * The wrapper present with no `reservation` list is a genuinely empty day.
 */
export const unwrapReservations = (json: unknown): RawReservation[] => {
  if (!json || typeof json !== 'object' || !('reservations' in json)) {
    throw new Error('25Live: unexpected reservations payload (missing "reservations")');
  }
  // XML-to-JSON renders an empty day as "", null or {}: all mean "no classes".
  const wrapper = (json as { reservations?: { reservation?: RawReservation[] } | '' | null })
    .reservations;
  return (wrapper && typeof wrapper === 'object' && wrapper.reservation) || [];
};

// TODO(25live): confirm feature names used by UMass.
const FEATURE_MAP: Record<string, Equipment> = {
  projector: 'projector',
  'video projector': 'projector',
  whiteboard: 'whiteboard',
  'white board': 'whiteboard',
  computers: 'computers',
  'computer lab': 'computers',
  'power outlets': 'outlets',
  outlets: 'outlets',
  'ada accessible': 'accessible',
  accessible: 'accessible',
};

const KNOWN_BUILDINGS = new Set(CAMPUS_BUILDINGS.map((b) => b.buildingId));

/** Room id is the space name slug: "LGRT 0101" → "LGRT-0101". */
export const roomIdFromSpaceName = (name: string) => name.trim().replace(/\s+/g, '-');

/** Null for spaces outside our seeded buildings (labs/offices are filtered upstream). */
export function mapSpace(raw: RawSpace): SourceRoom | null {
  const buildingId = raw.building_code ?? raw.space_name.trim().split(/\s+/)[0] ?? '';
  if (!KNOWN_BUILDINGS.has(buildingId) || !(raw.max_capacity > 0)) return null;
  const equipment = [
    ...new Set(
      (raw.features ?? [])
        .map((f) => FEATURE_MAP[f.feature_name.trim().toLowerCase()])
        .filter((e): e is Equipment => e !== undefined),
    ),
  ];
  return {
    roomId: roomIdFromSpaceName(raw.space_name),
    buildingId,
    name: raw.formal_name ?? raw.space_name,
    capacity: raw.max_capacity,
    equipment,
    twentyFiveLiveId: raw.space_id,
  };
}

const COURSE = /^([A-Z&]{2,10} \d{3}[A-Z]?)-(\w{1,4})\s*[:-]?\s*(.*)$/;

export function mapReservation(
  raw: RawReservation,
  roomIdBySpaceId: ReadonlyMap<number, string>,
): ClassEvent | null {
  const roomId = roomIdBySpaceId.get(raw.space_id);
  const start = new Date(raw.reservation_start_dt);
  const end = new Date(raw.reservation_end_dt);
  if (!roomId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }
  const m = COURSE.exec(raw.event.event_name.trim());
  return {
    eventId: `EV-${raw.event.event_id}-${raw.reservation_id}`,
    roomId,
    name: m?.[3] || raw.event.event_name.trim(),
    ...(m && { courseCode: m[1], section: m[2] }),
    ...(raw.event.event_type_name && { eventType: raw.event.event_type_name }),
    ...(raw.event.organization_name && { organization: raw.event.organization_name }),
    start,
    end,
  };
}
