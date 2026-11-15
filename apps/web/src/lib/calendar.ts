/** "Add to calendar" links built client-side from the same fields as the .ics file. */
export interface CalEvent {
  title: string;
  start: Date;
  end: Date;
  location: string;
  details: string;
}

/** 20261117T190000Z (UTC, no separators) — Google's `dates` format. */
export const gcalStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

export function googleCalendarUrl(e: CalEvent) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${gcalStamp(e.start)}/${gcalStamp(e.end)}`,
    location: e.location,
    details: e.details,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function outlookCalendarUrl(e: CalEvent) {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
    location: e.location,
    body: e.details,
  });
  return `https://outlook.live.com/calendar/0/action/compose?${p}`;
}

/** The fields every calendar entry shares (matches the server's .ics SUMMARY/LOCATION). */
export const studySession = (o: {
  roomName: string;
  buildingName: string;
  start: string;
  end: string;
  link: string;
}): CalEvent => ({
  title: `Study session · ${o.roomName}`,
  start: new Date(o.start),
  end: new Date(o.end),
  location: `${o.roomName}, ${o.buildingName}, UMass Amherst`,
  details: `Join on FreeRoom: ${o.link}`,
});
