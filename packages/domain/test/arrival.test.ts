import { describe, expect, it } from 'vitest';
import { arrivalVerdict, ceilToSlot, CLASS_SOON_MINUTES } from '../src/arrival';
import { campusLocalToUtc } from '../src/time';

const at = (local: string) => campusLocalToUtc(local);
const cls = (name: string, start: string, end: string) => ({
  kind: 'class' as const,
  name,
  start: at(start),
  end: at(end),
});
const res = (start: string, end: string, mine = false) => ({
  kind: 'reservation' as const,
  isMine: mine,
  start: at(start),
  end: at(end),
});

describe('arrivalVerdict', () => {
  it('free until the next booking when nothing is near', () => {
    const v = arrivalVerdict(at('2026-11-17T13:10'), [
      cls('CS 220', '2026-11-17T14:30', '2026-11-17T15:45'),
    ]);
    expect(v).toEqual({ kind: 'FREE_FOR', minutes: 80, until: at('2026-11-17T14:30') });
  });

  it('free until the end of the campus day when nothing else is booked', () => {
    const v = arrivalVerdict(at('2026-11-17T21:00'), []);
    expect(v).toEqual({ kind: 'FREE_FOR', minutes: 120, until: at('2026-11-17T23:00') });
  });

  it(`warns when a class starts less than ${CLASS_SOON_MINUTES} min after arrival`, () => {
    const v = arrivalVerdict(at('2026-11-17T14:26'), [
      cls('CS 220', '2026-11-17T14:30', '2026-11-17T15:45'),
    ]);
    expect(v).toEqual({
      kind: 'CLASS_STARTS_SOON',
      className: 'CS 220',
      inMinutes: 4,
      startsAt: at('2026-11-17T14:30'),
    });
  });

  it('exactly 30 min of free time is not "soon" (boundary)', () => {
    const v = arrivalVerdict(at('2026-11-17T14:00'), [
      cls('CS 220', '2026-11-17T14:30', '2026-11-17T15:45'),
    ]);
    expect(v.kind).toBe('FREE_FOR');
  });

  it('arriving exactly when a class ends is free (half-open intervals)', () => {
    const v = arrivalVerdict(at('2026-11-17T15:45'), [
      cls('CS 220', '2026-11-17T14:30', '2026-11-17T15:45'),
    ]);
    expect(v.kind).toBe('FREE_FOR');
  });

  it('arriving during a class: busy until the end of back-to-back bookings', () => {
    const v = arrivalVerdict(at('2026-11-17T14:40'), [
      cls('CS 220', '2026-11-17T14:30', '2026-11-17T15:45'),
      cls('MATH 233', '2026-11-17T15:45', '2026-11-17T17:00'),
      res('2026-11-17T17:00', '2026-11-17T17:30'),
    ]);
    expect(v).toEqual({ kind: 'BUSY_UNTIL', until: at('2026-11-17T17:30') });
  });

  it('arriving during my own reservation says YOURS', () => {
    const v = arrivalVerdict(at('2026-11-17T10:05'), [
      res('2026-11-17T10:00', '2026-11-17T11:00', true),
    ]);
    expect(v).toEqual({ kind: 'YOURS', until: at('2026-11-17T11:00') });
  });

  it('a reservation (not a class) starting soon is plain FREE_FOR', () => {
    const v = arrivalVerdict(at('2026-11-17T09:50'), [res('2026-11-17T10:00', '2026-11-17T11:00')]);
    expect(v).toEqual({ kind: 'FREE_FOR', minutes: 10, until: at('2026-11-17T10:00') });
  });

  it('after the campus day ends the room is closed until 7 AM', () => {
    const v = arrivalVerdict(at('2026-11-17T23:20'), []);
    expect(v).toEqual({ kind: 'BUSY_UNTIL', until: at('2026-11-18T07:00'), closed: true });
  });

  it('before the campus day starts the room opens at 7 AM', () => {
    const v = arrivalVerdict(at('2026-11-17T06:30'), []);
    expect(v).toEqual({ kind: 'BUSY_UNTIL', until: at('2026-11-17T07:00'), closed: true });
  });

  it('DST: the fall-back day still ends at 23:00 local', () => {
    // 2026-11-01 is the US fall-back day (a 25-hour day).
    const v = arrivalVerdict(at('2026-11-01T22:00'), []);
    expect(v).toEqual({ kind: 'FREE_FOR', minutes: 60, until: at('2026-11-01T23:00') });
  });
});

describe('ceilToSlot (reserve "for when I arrive")', () => {
  it('rounds up to the next 15-minute boundary, keeping exact boundaries', () => {
    expect(ceilToSlot(at('2026-11-17T13:01'))).toEqual(at('2026-11-17T13:15'));
    expect(ceilToSlot(at('2026-11-17T13:15'))).toEqual(at('2026-11-17T13:15'));
    expect(ceilToSlot(new Date(at('2026-11-17T13:14').getTime() + 59_999))).toEqual(
      at('2026-11-17T13:15'),
    );
  });
  it('DST spring-forward: rounding stays on real 15-minute boundaries', () => {
    // 2026-03-08: 02:00 EST jumps to 03:00 EDT; 01:52 EST rounds to 02:00 EST = 03:00 EDT.
    const before = new Date(Date.UTC(2026, 2, 8, 6, 52));
    expect(ceilToSlot(before).toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });
});
