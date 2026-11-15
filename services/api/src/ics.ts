/**
 * RFC 5545 calendar file for a reservation (group invites). One VEVENT, METHOD:PUBLISH, a
 * VTIMEZONE for America/New_York, DTSTART/DTEND in campus local time with TZID, a stable UID,
 * SEQUENCE = reservation version (bumps on every change), and a 15-minute VALARM.
 */
import { formatCampus } from '@freeroom/domain';

export interface IcsEvent {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  stamp: Date;
  summary: string;
  location: string;
  description: string;
  url: string;
  cancelled?: boolean;
}

/** TEXT escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, newline. */
export const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold content lines longer than 75 octets (RFC 5545 §3.1), never splitting a UTF-8 sequence. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const local = (d: Date) => formatCampus(d, "yyyyMMdd'T'HHmmss");
const utc = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'X-LIC-LOCATION:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export function buildIcs(e: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FreeRoom//Campus Rooms//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${utc(e.stamp)}`,
    `DTSTART;TZID=America/New_York:${local(e.start)}`,
    `DTEND;TZID=America/New_York:${local(e.end)}`,
    `SUMMARY:${escapeText(e.summary)}`,
    `LOCATION:${escapeText(e.location)}`,
    `DESCRIPTION:${escapeText(e.description)}`,
    `URL:${e.url}`,
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    `DESCRIPTION:${escapeText(`${e.summary} starts in 15 minutes`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
