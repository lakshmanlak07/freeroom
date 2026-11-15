import { describe, expect, it } from 'vitest';
import { fmtDistance, fmtWalk, reservePrefill, verdict } from './format';

describe('directions format', () => {
  it('walk time and distance read naturally', () => {
    expect(fmtWalk(20)).toBe('1 min walk');
    expect(fmtWalk(360)).toBe('6 min walk');
    expect(fmtDistance(30)).toBe('100 ft');
    expect(fmtDistance(480)).toBe('0.3 mi');
  });

  it('verdict copy carries the meaning in words, not just color', () => {
    expect(verdict({ kind: 'FREE_FOR', minutes: 80, until: '2026-11-17T19:30:00.000Z' })).toEqual({
      tone: 'free',
      text: 'Free for 1h 20m after you arrive',
    });
    expect(
      verdict({
        kind: 'CLASS_STARTS_SOON',
        className: 'CS 220',
        inMinutes: 4,
        startsAt: '2026-11-17T19:30:00.000Z',
      }).text,
    ).toBe('CS 220 starts 4 min after you arrive');
    expect(verdict({ kind: 'BUSY_UNTIL', until: '2026-11-17T20:45:00.000Z' }).text).toBe(
      'Busy until 3:45 PM',
    );
  });

  it('"Reserve it for when I arrive" rounds up to the next slot and stops at the next booking', () => {
    const p = reservePrefill({
      arriveAt: '2026-11-17T18:07:00.000Z',
      arrival: { kind: 'FREE_FOR', minutes: 38, until: '2026-11-17T18:45:00.000Z' },
    })!;
    expect(p.start.toISOString()).toBe('2026-11-17T18:15:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-17T18:45:00.000Z');
    const long = reservePrefill({
      arriveAt: '2026-11-17T18:00:00.000Z',
      arrival: { kind: 'FREE_FOR', minutes: 240, until: '2026-11-17T22:00:00.000Z' },
    })!;
    expect(long.end.toISOString()).toBe('2026-11-17T19:00:00.000Z'); // one hour
    expect(
      reservePrefill({
        arriveAt: '2026-11-17T18:07:00.000Z',
        arrival: { kind: 'BUSY_UNTIL', until: '2026-11-17T19:00:00.000Z' },
      }),
    ).toBeNull();
    expect(
      reservePrefill({
        arriveAt: '2026-11-17T18:07:00.000Z',
        arrival: {
          kind: 'CLASS_STARTS_SOON',
          className: 'CS 220',
          inMinutes: 8,
          startsAt: '2026-11-17T18:15:00.000Z',
        },
      }),
    ).toBeNull(); // no whole slot left before the class
  });
});

describe('ticket time', () => {
  it('drops the repeated AM/PM so the big time fits on one line', async () => {
    const { compactRange } = await import('../invites/Ticket');
    expect(compactRange('2026-11-17T01:00:00.000Z', '2026-11-17T02:30:00.000Z')).toBe(
      '8:00 – 9:30 PM',
    );
    expect(compactRange('2026-11-17T16:30:00.000Z', '2026-11-17T17:30:00.000Z')).toBe(
      '11:30 AM – 12:30 PM',
    );
  });
});
