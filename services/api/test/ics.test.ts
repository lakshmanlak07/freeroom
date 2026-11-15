import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText } from '../src/ics';

const base = {
  uid: 'res-123@freeroom',
  sequence: 3,
  start: new Date('2026-11-17T19:00:00.000Z'), // 2:00 PM EST
  end: new Date('2026-11-17T20:30:00.000Z'),
  stamp: new Date('2026-11-16T12:00:00.000Z'),
  summary: 'Study session · LGRT 0101',
  location: 'LGRT 0101, Lederle Graduate Research Tower, UMass Amherst',
  description:
    'Join on FreeRoom: https://example.test/i/abc\nGet directions: https://example.test/i/abc?directions=1',
  url: 'https://example.test/i/abc',
};

describe('buildIcs (RFC 5545)', () => {
  it('escapes commas, semicolons, backslashes and newlines, and round-trips through a parser', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const tricky = { ...base, summary: 'Midterm, review; CS\\220\nbring snacks' };
    const ev = new ICAL.Event(
      new ICAL.Component(ICAL.parse(buildIcs(tricky))).getFirstSubcomponent('vevent')!,
    );
    expect(ev.summary).toBe(tricky.summary);
    expect(ev.location).toBe(base.location);
    expect(ev.description).toBe(base.description);
  });

  it('uses CRLF, folds lines at 75 octets and keeps campus-local DTSTART with TZID', () => {
    const text = buildIcs({ ...base, description: 'x'.repeat(300) });
    expect(text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(text).toContain('DTSTART;TZID=America/New_York:20261117T140000');
    expect(text).toContain('DTEND;TZID=America/New_York:20261117T153000');
    expect(text).toContain('SEQUENCE:3');
    expect(text).toContain('TRIGGER:-PT15M');
  });

  it('summer dates are local EDT time and resolve back to the right instant via the VTIMEZONE', () => {
    const summer = buildIcs({
      ...base,
      start: new Date('2026-07-01T18:00:00.000Z'),
      end: new Date('2026-07-01T19:00:00.000Z'),
    });
    expect(summer).toContain('DTSTART;TZID=America/New_York:20260701T140000');
    const comp = new ICAL.Component(ICAL.parse(summer));
    const tz = new ICAL.Timezone(comp.getFirstSubcomponent('vtimezone')!);
    const ev = new ICAL.Event(comp.getFirstSubcomponent('vevent')!);
    const start = ev.startDate.clone();
    start.zone = tz;
    expect(start.toJSDate().toISOString()).toBe('2026-07-01T18:00:00.000Z');
  });

  it('matches the snapshot', () => {
    expect(buildIcs(base)).toMatchSnapshot();
  });
});
