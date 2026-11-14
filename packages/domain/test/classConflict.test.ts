import { describe, expect, it } from 'vitest';
import { findClassConflicts, type ClassEvent } from '../src/classConflict';

const t = (iso: string) => new Date(iso);
const cls = (id: string, s: string, e: string, roomId = 'R1'): ClassEvent => ({
  eventId: id,
  roomId,
  name: `Class ${id}`,
  courseCode: 'COMPSCI 220',
  section: '01',
  eventType: 'Lecture',
  organization: 'Computer Science',
  start: t(s),
  end: t(e),
});
const req = (s: string, e: string, roomId = 'R1') => ({ roomId, start: t(s), end: t(e) });

describe('BR-1 class conflict', () => {
  const classes = [
    cls('a', '2026-11-16T14:00Z', '2026-11-16T15:15Z'),
    cls('b', '2026-11-16T16:00Z', '2026-11-16T17:00Z'),
    cls('other-room', '2026-11-16T12:00Z', '2026-11-16T20:00Z', 'R2'),
  ];

  it('rejects partial overlap', () => {
    expect(
      findClassConflicts(req('2026-11-16T15:00Z', '2026-11-16T15:30Z'), classes).map(
        (c) => c.eventId,
      ),
    ).toEqual(['a']);
  });
  it('allows touching edges (back-to-back)', () => {
    expect(findClassConflicts(req('2026-11-16T15:15Z', '2026-11-16T16:00Z'), classes)).toEqual([]);
    expect(findClassConflicts(req('2026-11-16T13:00Z', '2026-11-16T14:00Z'), classes)).toEqual([]);
  });
  it('rejects reservation contained in a class', () => {
    expect(findClassConflicts(req('2026-11-16T14:15Z', '2026-11-16T14:30Z'), classes)).toHaveLength(
      1,
    );
  });
  it('rejects reservation containing a class', () => {
    expect(
      findClassConflicts(req('2026-11-16T15:45Z', '2026-11-16T17:15Z'), classes).map(
        (c) => c.eventId,
      ),
    ).toEqual(['b']);
  });
  it('reports every overlapping class', () => {
    expect(
      findClassConflicts(req('2026-11-16T14:00Z', '2026-11-16T18:00Z'), classes).map(
        (c) => c.eventId,
      ),
    ).toEqual(['a', 'b']);
  });
  it('ignores classes in other rooms', () => {
    expect(findClassConflicts(req('2026-11-16T12:00Z', '2026-11-16T13:00Z'), classes)).toEqual([]);
  });

  it('uses real instants on the DST fall-back day', () => {
    // 2026-11-01: 01:00–02:00 EDT (05:00–06:00Z), then clocks fall back; 01:30 EST is 06:30Z.
    const dst = [cls('early', '2026-11-01T05:00Z', '2026-11-01T06:00Z')];
    // Same wall-clock label "1:30 AM", but after fall-back: no overlap.
    expect(findClassConflicts(req('2026-11-01T06:30Z', '2026-11-01T07:00Z'), dst)).toEqual([]);
    // 1:30 AM EDT (first occurrence) overlaps.
    expect(findClassConflicts(req('2026-11-01T05:30Z', '2026-11-01T06:00Z'), dst)).toHaveLength(1);
    // Touching at the repeated hour boundary is allowed.
    expect(findClassConflicts(req('2026-11-01T06:00Z', '2026-11-01T06:15Z'), dst)).toEqual([]);
  });
});
