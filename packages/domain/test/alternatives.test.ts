import { describe, expect, it } from 'vitest';
import { distanceMeters, findAlternatives, type RoomCandidate } from '../src/alternatives';

const t = (iso: string) => new Date(iso);
const window = { start: t('2026-11-16T15:00Z'), end: t('2026-11-16T16:00Z') };
const origin = {
  roomId: 'LGRT-101',
  buildingId: 'LGRT',
  lat: 42.3906,
  lng: -72.5266,
  window,
  partySize: 5,
};

const room = (
  roomId: string,
  buildingId: string,
  capacity: number,
  lat: number,
  lng: number,
  busy: RoomCandidate['busy'] = [],
): RoomCandidate => ({ roomId, buildingId, capacity, lat, lng, busy });

describe('BR-9 alternatives', () => {
  const candidates = [
    room('LGRT-101', 'LGRT', 40, 42.3906, -72.5266), // the original
    room('LGRT-202', 'LGRT', 30, 42.3906, -72.5266),
    room('LGRT-203', 'LGRT', 4, 42.3906, -72.5266), // too small
    room('LGRT-204', 'LGRT', 20, 42.3906, -72.5266, [
      { start: t('2026-11-16T15:45Z'), end: t('2026-11-16T17:00Z') },
    ]), // busy
    room('ILC-1', 'ILC', 50, 42.391, -72.525), // near
    room('TOB-1', 'TOB', 10, 42.394, -72.529), // farther
    room('MOR-1', 'MOR', 10, 42.389, -72.524, [
      { start: t('2026-11-16T16:00Z'), end: t('2026-11-16T17:00Z') },
    ]), // touching → free
  ];

  it('returns same building first, then nearest, max 3, excluding original/small/busy', () => {
    const result = findAlternatives(origin, candidates).map((r) => r.roomId);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('LGRT-202');
    expect(result).not.toContain('LGRT-101');
    expect(result).not.toContain('LGRT-203');
    expect(result).not.toContain('LGRT-204');
    const d = (id: string) =>
      distanceMeters(
        origin,
        candidates.find((x) => x.roomId === id)!,
      );
    expect(d(result[1]!)).toBeLessThanOrEqual(d(result[2]!));
  });

  it('honours a custom limit and returns [] when nothing fits', () => {
    expect(findAlternatives(origin, candidates, 1).map((r) => r.roomId)).toEqual(['LGRT-202']);
    expect(findAlternatives({ ...origin, partySize: 500 }, candidates)).toEqual([]);
  });

  it('breaks ties deterministically by capacity then id', () => {
    const tie = [room('B', 'X', 20, 1, 1), room('A', 'X', 20, 1, 1), room('C', 'X', 10, 1, 1)];
    expect(
      findAlternatives({ ...origin, buildingId: 'Z', lat: 0, lng: 0 }, tie).map((r) => r.roomId),
    ).toEqual(['C', 'A', 'B']);
  });

  it('computes haversine distance', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -2);
  });
});
