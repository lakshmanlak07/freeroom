import { describe, expect, it } from 'vitest';
import { gcalStamp, googleCalendarUrl, outlookCalendarUrl, studySession } from './calendar';

const ev = studySession({
  roomName: 'LGRT 0101',
  buildingName: 'Lederle Graduate Research Tower',
  start: '2026-11-17T19:00:00.000Z',
  end: '2026-11-17T20:30:00.000Z',
  link: 'https://freeroom.example/i/abc',
});

describe('add-to-calendar links', () => {
  it('Google uses compact UTC stamps', () => {
    expect(gcalStamp(new Date('2026-11-17T19:00:00.000Z'))).toBe('20261117T190000Z');
    const u = new URL(googleCalendarUrl(ev));
    expect(u.hostname).toBe('calendar.google.com');
    expect(u.searchParams.get('dates')).toBe('20261117T190000Z/20261117T203000Z');
    expect(u.searchParams.get('text')).toBe('Study session · LGRT 0101');
    expect(u.searchParams.get('location')).toBe(
      'LGRT 0101, Lederle Graduate Research Tower, UMass Amherst',
    );
  });
  it('Outlook uses ISO UTC start/end', () => {
    const u = new URL(outlookCalendarUrl(ev));
    expect(u.hostname).toBe('outlook.live.com');
    expect(u.searchParams.get('startdt')).toBe('2026-11-17T19:00:00.000Z');
    expect(u.searchParams.get('enddt')).toBe('2026-11-17T20:30:00.000Z');
  });
});
