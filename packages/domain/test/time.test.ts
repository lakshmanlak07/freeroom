import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  SLOT_MS,
  addDays,
  addHours,
  campusDay,
  campusDayStart,
  campusDaysOf,
  campusLocalToUtc,
  coveringSlots,
  enumerateSlots,
  formatCampus,
  isSlotAligned,
  overlaps,
  type Interval,
} from '../src/time';

const t = (iso: string) => new Date(iso);
const iv = (s: string, e: string): Interval => ({ start: t(s), end: t(e) });

describe('overlaps (half-open)', () => {
  it('detects partial overlap', () => {
    expect(
      overlaps(
        iv('2026-11-16T14:00Z', '2026-11-16T15:00Z'),
        iv('2026-11-16T14:30Z', '2026-11-16T16:00Z'),
      ),
    ).toBe(true);
  });
  it('allows touching edges both ways', () => {
    const a = iv('2026-11-16T14:00Z', '2026-11-16T15:00Z');
    const b = iv('2026-11-16T15:00Z', '2026-11-16T16:00Z');
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, a)).toBe(false);
  });
  it('detects containment', () => {
    expect(
      overlaps(
        iv('2026-11-16T14:00Z', '2026-11-16T18:00Z'),
        iv('2026-11-16T15:00Z', '2026-11-16T15:15Z'),
      ),
    ).toBe(true);
  });
  it('is false for disjoint intervals', () => {
    expect(
      overlaps(
        iv('2026-11-16T10:00Z', '2026-11-16T11:00Z'),
        iv('2026-11-16T12:00Z', '2026-11-16T13:00Z'),
      ),
    ).toBe(false);
  });

  const arbInterval = fc
    .tuple(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 1, max: 500 }))
    .map(([s, len]): Interval => ({
      start: new Date(s * 60_000),
      end: new Date((s + len) * 60_000),
    }));

  it('property: symmetric, reflexive, touching never overlaps', () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, (a, b) => {
        expect(overlaps(a, b)).toBe(overlaps(b, a));
        expect(overlaps(a, a)).toBe(true);
        expect(overlaps(a, { start: a.end, end: new Date(a.end.getTime() + 60_000) })).toBe(false);
      }),
    );
  });
});

describe('slots', () => {
  it('checks 15-minute alignment', () => {
    expect(isSlotAligned(t('2026-11-16T14:15:00Z'))).toBe(true);
    expect(isSlotAligned(t('2026-11-16T14:10:00Z'))).toBe(false);
    expect(isSlotAligned(t('2026-11-16T14:15:01Z'))).toBe(false);
    expect(isSlotAligned(t('2026-11-16T14:15:00.001Z'))).toBe(false);
  });

  it('enumerates slot starts', () => {
    const slots = enumerateSlots(iv('2026-11-16T14:00Z', '2026-11-16T15:00Z'));
    expect(slots.map((d) => d.toISOString())).toEqual([
      '2026-11-16T14:00:00.000Z',
      '2026-11-16T14:15:00.000Z',
      '2026-11-16T14:30:00.000Z',
      '2026-11-16T14:45:00.000Z',
    ]);
  });

  it('counts real time across the DST fall-back (4 real hours = 16 slots)', () => {
    // 2026-11-01 00:00 EDT → 03:00 EST is 4 real hours.
    expect(enumerateSlots(iv('2026-11-01T04:00Z', '2026-11-01T08:00Z'))).toHaveLength(16);
  });

  it('covers every slot an unaligned class touches', () => {
    const slots = coveringSlots(iv('2026-11-16T14:05Z', '2026-11-16T14:55Z'));
    expect(slots.map((d) => d.toISOString())).toEqual([
      '2026-11-16T14:00:00.000Z',
      '2026-11-16T14:15:00.000Z',
      '2026-11-16T14:30:00.000Z',
      '2026-11-16T14:45:00.000Z',
    ]);
    expect(coveringSlots(iv('2026-11-16T14:00Z', '2026-11-16T14:15Z'))).toHaveLength(1);
  });

  it('rejects unaligned or empty intervals', () => {
    expect(() => enumerateSlots(iv('2026-11-16T14:05Z', '2026-11-16T15:00Z'))).toThrow(RangeError);
    expect(() => enumerateSlots(iv('2026-11-16T14:00Z', '2026-11-16T14:00Z'))).toThrow(RangeError);
  });

  it('property: slot count = duration / 15 min', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 1, max: 32 }), (s, n) => {
        const start = new Date(s * SLOT_MS);
        const end = new Date((s + n) * SLOT_MS);
        expect(enumerateSlots({ start, end })).toHaveLength(n);
      }),
    );
  });
});

describe('campus time (America/New_York)', () => {
  it('computes campus day, not UTC day', () => {
    expect(campusDay(t('2026-11-15T03:30:00Z'))).toBe('2026-11-14');
    expect(campusDay(t('2026-11-15T05:30:00Z'))).toBe('2026-11-15');
  });
  it('converts campus wall time to UTC in EST and EDT', () => {
    expect(campusLocalToUtc('2026-11-16T09:00').toISOString()).toBe('2026-11-16T14:00:00.000Z');
    expect(campusLocalToUtc('2026-07-01T09:00').toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });
  it('formats in campus time', () => {
    expect(formatCampus(t('2026-11-16T19:15:00Z'), 'h:mm a')).toBe('2:15 PM');
  });
  it('does day arithmetic and campus midnights across DST', () => {
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(campusDayStart('2026-11-01').toISOString()).toBe('2026-11-01T04:00:00.000Z'); // EDT
    expect(campusDayStart('2026-11-02').toISOString()).toBe('2026-11-02T05:00:00.000Z'); // EST
  });
  it('lists campus days an interval touches (half-open)', () => {
    expect(campusDaysOf(iv('2026-11-16T14:00Z', '2026-11-16T15:00Z'))).toEqual(['2026-11-16']);
    // 23:00–01:00 EST spans two campus days; ending exactly at midnight does not.
    expect(campusDaysOf(iv('2026-11-17T04:00Z', '2026-11-17T06:00Z'))).toEqual([
      '2026-11-16',
      '2026-11-17',
    ]);
    expect(campusDaysOf(iv('2026-11-17T04:00Z', '2026-11-17T05:00Z'))).toEqual(['2026-11-16']);
  });
  it('adds real hours', () => {
    expect(addHours(t('2026-11-16T14:00:00Z'), -4).toISOString()).toBe('2026-11-16T10:00:00.000Z');
  });
});
