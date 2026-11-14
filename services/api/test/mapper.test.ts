import { describe, expect, it } from 'vitest';
import {
  mapReservation,
  mapSpace,
  roomIdFromSpaceName,
  unwrapReservations,
  unwrapSpaces,
  type RawReservation,
} from '../src/twentyfive/mapper';
import { MockSource, mockReservations, mockSpaces } from '../src/twentyfive/mock';

const raw: RawReservation = {
  reservation_id: 9,
  reservation_start_dt: '2026-11-16T09:05:00-05:00',
  reservation_end_dt: '2026-11-16T09:55:00-05:00',
  space_id: 1,
  event: {
    event_id: 7,
    event_name: 'COMPSCI 220-01: Programming Methodology',
    event_type_name: 'Lecture',
    organization_name: 'Computer Science',
  },
};
const rooms = new Map([[1, 'LGRT-0101']]);

describe('mapper', () => {
  it('maps a space with equipment and building', () => {
    expect(
      mapSpace({
        space_id: 1,
        space_name: 'LGRT 0101',
        max_capacity: 40,
        features: [
          { feature_name: 'Projector' },
          { feature_name: 'White Board' },
          { feature_name: 'Sofa' },
        ],
      }),
    ).toEqual({
      roomId: 'LGRT-0101',
      buildingId: 'LGRT',
      name: 'LGRT 0101',
      capacity: 40,
      equipment: ['projector', 'whiteboard'],
      twentyFiveLiveId: 1,
    });
  });

  it('drops unknown buildings and zero capacity', () => {
    expect(mapSpace({ space_id: 2, space_name: 'XYZ 1', max_capacity: 10 })).toBeNull();
    expect(mapSpace({ space_id: 3, space_name: 'ILC 1', max_capacity: 0 })).toBeNull();
  });

  it('maps a class with parsed course code and real UTC instants', () => {
    expect(mapReservation(raw, rooms)).toEqual({
      eventId: 'EV-7-9',
      roomId: 'LGRT-0101',
      name: 'Programming Methodology',
      courseCode: 'COMPSCI 220',
      section: '01',
      eventType: 'Lecture',
      organization: 'Computer Science',
      start: new Date('2026-11-16T14:05:00Z'),
      end: new Date('2026-11-16T14:55:00Z'),
    });
  });

  it('keeps non-course event names and drops bad records', () => {
    const plain = { ...raw, event: { event_id: 8, event_name: 'Senate Meeting' } };
    expect(mapReservation(plain, rooms)).toMatchObject({ name: 'Senate Meeting' });
    expect(mapReservation(plain, rooms)).not.toHaveProperty('courseCode');
    expect(mapReservation({ ...raw, space_id: 99 }, rooms)).toBeNull();
    expect(mapReservation({ ...raw, reservation_start_dt: 'nope' }, rooms)).toBeNull();
    expect(
      mapReservation({ ...raw, reservation_end_dt: raw.reservation_start_dt }, rooms),
    ).toBeNull();
  });

  it('unwraps 25Live wrappers defensively', () => {
    expect(unwrapSpaces({ spaces: { space: [{ space_id: 1 }] } })).toHaveLength(1);
    expect(unwrapSpaces({})).toEqual([]);
    expect(unwrapReservations({ reservations: { reservation: [raw] } })).toHaveLength(1);
    expect(unwrapReservations({ reservations: {} })).toEqual([]);
    expect(roomIdFromSpaceName(' ILC  S131 ')).toBe('ILC-S131');
  });
});

describe('mock campus', () => {
  it('is deterministic: 10 buildings, 80 rooms, capacities 8–300', async () => {
    expect(mockSpaces()).toEqual(mockSpaces());
    const rooms = await new MockSource().listRooms();
    expect(rooms).toHaveLength(80);
    expect(new Set(rooms.map((r) => r.buildingId)).size).toBe(10);
    expect(Math.min(...rooms.map((r) => r.capacity))).toBeGreaterThanOrEqual(8);
    expect(Math.max(...rooms.map((r) => r.capacity))).toBeLessThanOrEqual(300);
  });

  it('generates MWF/TuTh weekday classes only, through the mapper', async () => {
    const from = new Date('2026-11-16T05:00:00Z'); // Mon 00:00 EST
    const to = new Date('2026-11-23T05:00:00Z');
    expect(mockReservations(from, to)).toEqual(mockReservations(from, to));
    const src = new MockSource();
    const rooms = (await src.listRooms()).map((r) => r.roomId);
    const events = await src.listEvents(rooms, from, to);
    expect(events.length).toBeGreaterThan(200);
    const weekend = events.filter((e) =>
      [0, 6].includes(new Date(e.start.getTime() - 5 * 3600_000).getUTCDay()),
    );
    expect(weekend).toEqual([]);
    expect(events.every((e) => e.courseCode && e.section && e.organization)).toBe(true);
    expect(await new MockSource({ generateClasses: false }).listEvents(rooms, from, to)).toEqual(
      [],
    );
  });
});
