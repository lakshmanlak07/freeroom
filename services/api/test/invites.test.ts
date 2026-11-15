/** Group invites: tokens, privacy, capacity race, joins, notifications, calendar files. */
import { GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import ICAL from 'ical.js';
import { DEFAULT_ROLE_LIMITS } from '@freeroom/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashInviteToken, joinReservation } from '../src/data/invites';
import { keys } from '../src/data/keys';
import { queryAll } from '../src/data/db';
import { getReservation } from '../src/data/reservations';
import { mapRecord } from '../src/notify/onChange';
import { createLogger } from '../src/logger';
import { setupTestApp } from './helpers';

const NOW = new Date('2026-11-16T12:00:00Z');
type T = Awaited<ReturnType<typeof setupTestApp>>;
let t: T;
const lines: string[] = [];
beforeAll(async () => {
  t = await setupTestApp({
    now: NOW,
    deps: {
      logger: createLogger({}, (l) => lines.push(l)),
      features: { invites: true },
      // Many bookings by one host in this suite; production quotas are unchanged.
      limits: { ...DEFAULT_ROLE_LIMITS, FACULTY: { maxActive: 50, maxDurationMinutes: 240 } },
    },
  });
});

let slot = 0;
async function booking(owner = 'faculty1') {
  const h = 13 + slot++;
  const r = await t.reserve(
    owner,
    'CS-0101',
    `2026-11-18T${h}:00:00.000Z`,
    `2026-11-18T${h}:30:00.000Z`,
  );
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const invite = async (resId: string, user = 'faculty1') =>
  t.req(user, 'POST', `/reservations/${resId}/invites`);
const anon = (path: string) => t.app.request(path);

describe('invite links', () => {
  it('only the SHA-256 of the token is stored (proven by scanning the table)', async () => {
    const id = await booking();
    const r = await invite(id);
    expect(r.status).toBe(201);
    const { token, url } = r.body as { token: string; url: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 bits, base64url
    expect(url.endsWith(`/i/${token}`)).toBe(true);
    const items = (await t.db.doc.send(new ScanCommand({ TableName: t.db.table }))).Items ?? [];
    expect(JSON.stringify(items)).not.toContain(token);
    expect(items.some((i) => i.PK === `INVITE#${hashInviteToken(token)}`)).toBe(true);
  });

  it('the token never reaches the logs (preview, join, calendar)', async () => {
    const id = await booking();
    const { token } = (await invite(id)).body as { token: string };
    await anon(`/invites/${token}`);
    await anon(`/invites/${token}/calendar.ics`);
    await t.req('tutor1', 'POST', `/invites/${token}/join`);
    const all = lines.join('\n');
    expect(all).toContain('/invites/:token'); // the request was logged…
    expect(all).not.toContain(token); // …without the capability
  });

  it('only the owner can create or revoke a link (others get 404)', async () => {
    const id = await booking();
    expect((await invite(id, 'tutor1')).status).toBe(404);
    expect((await t.req('tutor1', 'DELETE', `/reservations/${id}/invites`)).status).toBe(404);
  });

  it('unknown, revoked, replaced and expired tokens all look the same: 404', async () => {
    const id = await booking();
    const first = (await invite(id)).body.token as string;
    const second = (await invite(id)).body.token as string; // replaces the first
    const unknown = 'A'.repeat(22);
    const msg = async (tok: string) => {
      const res = await anon(`/invites/${tok}`);
      const body = (await res.json()) as { error?: { message: string } };
      return [res.status, body.error?.message];
    };
    const notFound = await msg(unknown);
    expect(notFound[0]).toBe(404);
    expect(await msg(first)).toEqual(notFound);
    expect((await anon(`/invites/${second}`)).status).toBe(200);
    expect((await t.req('faculty1', 'DELETE', `/reservations/${id}/invites`)).status).toBe(200);
    expect(await msg(second)).toEqual(notFound);

    const id2 = await booking();
    const tok = (await invite(id2)).body.token as string;
    const end = (await getReservation(t.db, id2))!.end;
    t.clock.now = new Date(Date.parse(end) + 1000);
    expect(await msg(tok)).toEqual(notFound);
    t.clock.now = NOW;
  });

  it('the public preview is safe: aliases, room and time only — no ids, no contact', async () => {
    const id = await booking();
    const tok = (await invite(id)).body.token as string;
    await t.req('student1', 'POST', `/invites/${tok}/join`);
    const res = await anon(`/invites/${tok}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const text = JSON.stringify(body);
    for (const leak of ['faculty1', 'student1', '@', 'ownerId', 'userId', id, 'universityId']) {
      expect(text).not.toContain(leak);
    }
    expect(body).toMatchObject({
      roomId: 'CS-0101',
      hostAlias: 'Prof. Maple',
      attendees: [{ alias: 'Night Owl' }],
      attendeeCount: 1,
      status: 'PENDING_CONFIRMATION',
    });
    expect(body.viewer).toBeUndefined(); // signed out
  });
});

describe('joining', () => {
  it('is idempotent, and the owner cannot join their own booking', async () => {
    const id = await booking();
    const tok = (await invite(id)).body.token as string;
    expect((await t.req('student1', 'POST', `/invites/${tok}/join`)).body).toMatchObject({
      joined: true,
      already: false,
    });
    expect((await t.req('student1', 'POST', `/invites/${tok}/join`)).body).toMatchObject({
      joined: true,
      already: true,
    });
    const own = await t.req('faculty1', 'POST', `/invites/${tok}/join`);
    expect(own.status).toBe(400);
    expect(own.body.error.code).toBe('OWN_RESERVATION');
    const view = await t.req('student1', 'GET', `/invites/${tok}`);
    expect(view.body.viewer).toEqual({ isHost: false, joined: true });
    expect(view.body.attendeeCount).toBe(1);
  });

  it('capacity race: 20 concurrent joins on a capacity-5 room → exactly 4 succeed (owner counts)', async () => {
    const id = await booking();
    const rec = (await getReservation(t.db, id))!;
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        joinReservation(t.db, rec, { userId: `racer-${i}`, displayAlias: `Racer ${i}` }, 5, NOW),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const full = results.filter(
      (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'ROOM_FULL',
    );
    expect(ok).toHaveLength(4);
    expect(full).toHaveLength(16);
    const meta = await t.db.doc.send(
      new GetCommand({ TableName: t.db.table, Key: keys.reservation(id) }),
    );
    expect(meta.Item?.attendeeCount).toBe(4);
  });

  it('attendees can leave; attendees are not owners (cannot cancel)', async () => {
    const id = await booking();
    const tok = (await invite(id)).body.token as string;
    await t.req('tutor1', 'POST', `/invites/${tok}/join`);
    expect((await t.req('tutor1', 'DELETE', `/reservations/${id}`)).status).toBe(403);
    expect((await t.req('tutor1', 'DELETE', `/invites/${tok}/join`)).status).toBe(200);
    const after = (await (await anon(`/invites/${tok}`)).json()) as { attendeeCount: number };
    expect(after.attendeeCount).toBe(0);
  });
});

describe('notifications', () => {
  it('the owner hears about joins; attendees hear about a cancellation', async () => {
    const id = await booking();
    const tok = (await invite(id)).body.token as string;
    await t.req('student2', 'POST', `/invites/${tok}/join`);
    expect((await t.req('faculty1', 'DELETE', `/reservations/${id}`)).status).toBe(200);
    // Raw EVT items: the internal `notify` list is never part of the API projection.
    const events = await queryAll(t.db, {
      KeyConditionExpression: 'PK = :p AND begins_with(SK, :e)',
      ExpressionAttributeValues: { ':p': keys.resPk(id), ':e': keys.prefix.evt },
    });
    const joined = events.find((e) => e.type === 'ATTENDEE_JOINED')!;
    const cancelled = events.find((e) => e.type === 'CANCELLED')!;
    expect(joined.notify).toEqual(['faculty1']);
    expect(cancelled.notify).toEqual(['student2']);
    const asRecord = (e: object) => ({
      eventName: 'INSERT' as const,
      newImage: { ...e, SK: 'EVT#x', reservationId: id },
    });
    expect(mapRecord(asRecord(joined))).toEqual([
      expect.objectContaining({ userId: 'faculty1', type: 'invite.joined' }),
    ]);
    expect(mapRecord(asRecord(cancelled))).toEqual([
      expect.objectContaining({ userId: 'student2', type: 'reservation.cancelled' }),
    ]);
  });
});

describe('calendar (.ics)', () => {
  it('public and owner/attendee calendar files parse as valid iCalendar in campus time', async () => {
    const id = await booking();
    const tok = (await invite(id)).body.token as string;
    const res = await anon(`/invites/${tok}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="freeroom-.+\.ics"$/,
    );
    const text = await res.text();
    expect(text).not.toContain('faculty1');
    const comp = new ICAL.Component(ICAL.parse(text));
    expect(comp.getFirstPropertyValue('method')).toBe('PUBLISH');
    const vevent = comp.getFirstSubcomponent('vevent')!;
    const ev = new ICAL.Event(vevent);
    expect(ev.uid).toBe(`${id}@freeroom`);
    expect(ev.summary).toMatch(/^Study session · /);
    expect(ev.location).toMatch(/UMass Amherst$/);
    expect(vevent.getFirstProperty('dtstart')!.getParameter('tzid')).toBe('America/New_York');
    expect(vevent.getFirstSubcomponent('valarm')).toBeTruthy();

    const owner = await t.app.request(`/reservations/${id}/calendar.ics`, {
      headers: { 'x-dev-user': 'faculty1' },
    });
    expect(owner.status).toBe(200);
    const stranger = await t.app.request(`/reservations/${id}/calendar.ics`, {
      headers: { 'x-dev-user': 'tutor1' },
    });
    expect(stranger.status).toBe(404);
  });
});
