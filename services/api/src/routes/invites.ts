/**
 * Group invites + calendar (feature flag `features.invites`).
 *   POST   /reservations/:id/invites        owner → { token, url, expiresAt } (10/hour/user)
 *   DELETE /reservations/:id/invites        owner → revoke
 *   GET    /invites/:token                  PUBLIC safe preview (aliases only, never ids/contact)
 *   GET    /invites/:token/calendar.ics     PUBLIC, same safe fields
 *   POST   /invites/:token/join             join as attendee (idempotent; owner can't)
 *   DELETE /invites/:token/join             leave
 *   GET    /reservations/:id/calendar.ics   owner or attendee
 * Unknown, revoked and expired tokens are indistinguishable (404).
 */
import type { AlternativeRoom, InviteCreateResponse, InvitePreview } from '@freeroom/shared';
import { Hono, type Context } from 'hono';
import type { Ctx, Env } from '../app';
import { getCatalog } from '../data/catalog';
import {
  createInvite,
  joinReservation,
  leaveReservation,
  listAttendees,
  resolveInvite,
  revokeInvite,
} from '../data/invites';
import {
  getReservation,
  listReservationEvents,
  type ReservationRecord,
} from '../data/reservations';
import { getUser, takeRateToken } from '../data/users';
import { AppError } from '../errors';
import { buildIcs } from '../ics';
import { metric } from '../metrics';
import { ENTRANCES } from '../twentyfive/campus';

export const INVITES_PER_HOUR = 10;
const ACTIVE = ['PENDING_CONFIRMATION', 'CONFIRMED'];
const gone = () => new AppError('NOT_FOUND', 'This invite link isn’t valid anymore');

/**
 * The site origin for links. Deployed: CloudFront's /api viewer-request function sets
 * x-freeroom-origin from the viewer Host (a client can't override it). Local: the request Origin.
 */
export function siteOrigin(c: Context<Env>) {
  const set = c.req.header('x-freeroom-origin');
  if (set && /^https:\/\/[a-z0-9.-]+$/.test(set)) return set;
  const o = c.req.header('origin');
  if (o && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  return 'http://localhost:5173';
}

export function inviteRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  async function owned(c: Context<Env>) {
    const user = c.get('user');
    if (!user) throw new AppError('UNAUTHORIZED', 'Sign in required');
    const rec = await getReservation(ctx.db, c.req.param('id')!);
    if (!rec || rec.ownerId !== user.userId) {
      throw new AppError('NOT_FOUND', 'Reservation not found');
    }
    return { user, rec };
  }

  async function placeOf(rec: ReservationRecord) {
    const { rooms, buildings } = await getCatalog(ctx.db, ctx.now().getTime());
    const room = rooms.find((x) => x.roomId === rec.roomId);
    const building = buildings.find((b) => b.buildingId === room?.buildingId);
    const door = ENTRANCES[room?.buildingId ?? '']?.main;
    return {
      roomName: room?.name ?? rec.roomId,
      capacity: room?.capacity ?? 1,
      buildingId: room?.buildingId ?? '',
      buildingName: building?.name ?? '',
      entrance: door
        ? { lat: door.lat, lng: door.lng }
        : { lat: building?.lat ?? 0, lng: building?.lng ?? 0 },
    };
  }

  r.post('/reservations/:id/invites', async (c) => {
    const { user, rec } = await owned(c);
    const now = ctx.now();
    if (!ACTIVE.includes(rec.status) || rec.end <= now.toISOString()) {
      throw new AppError('INVALID_TRANSITION', 'Only upcoming bookings can be shared');
    }
    if (!(await takeRateToken(ctx.db, user.userId, 'invite', now, INVITES_PER_HOUR, 'hour'))) {
      throw new AppError('RATE_LIMITED', 'That’s a lot of new links — try again in a bit');
    }
    const { token, expiresAt } = await createInvite(ctx.db, rec, now);
    metric('InvitesCreated');
    const body: InviteCreateResponse = { token, url: `${siteOrigin(c)}/i/${token}`, expiresAt };
    return c.json(body, 201);
  });

  r.delete('/reservations/:id/invites', async (c) => {
    const { rec } = await owned(c);
    await revokeInvite(ctx.db, rec.id);
    return c.json({ revoked: true });
  });

  async function preview(c: Context<Env>) {
    const found = await resolveInvite(ctx.db, c.req.param('token')!, ctx.now());
    if (!found) throw gone();
    const { rec } = found;
    const [place, attendees, host] = await Promise.all([
      placeOf(rec),
      listAttendees(ctx.db, rec.id),
      getUser(ctx.db, rec.ownerId),
    ]);
    let alternatives: AlternativeRoom[] | undefined;
    if (rec.status === 'RELEASED' && rec.releaseReason === 'CLASS_CONFLICT') {
      const rel = (await listReservationEvents(ctx.db, rec.id)).find((e) => e.type === 'RELEASED');
      alternatives = ((rel?.data?.alternatives ?? []) as AlternativeRoom[]).map((a) => ({
        roomId: a.roomId,
        name: a.name,
        buildingId: a.buildingId,
        buildingName: a.buildingName,
        capacity: a.capacity,
        start: a.start,
        end: a.end,
      }));
    }
    const user = c.get('user');
    const body: InvitePreview = {
      roomId: rec.roomId,
      roomName: place.roomName,
      buildingId: place.buildingId,
      buildingName: place.buildingName,
      start: rec.start,
      end: rec.end,
      hostAlias: host?.displayAlias ?? 'A FreeRoom user',
      attendees: attendees.map((a) => ({ alias: a.alias })),
      attendeeCount: attendees.length,
      capacity: place.capacity,
      status: rec.status,
      releaseReason: rec.releaseReason,
      ...(alternatives && { alternatives }),
      entrance: place.entrance,
      ...(user && {
        viewer: {
          isHost: user.userId === rec.ownerId,
          joined: attendees.some((a) => a.userId === user.userId),
        },
      }),
    };
    return { rec, body };
  }

  r.get('/invites/:token', async (c) => {
    const { body } = await preview(c);
    c.header('cache-control', 'no-store');
    c.header('x-robots-tag', 'noindex');
    return c.json(body);
  });

  r.post('/invites/:token/join', async (c) => {
    const user = c.get('user');
    if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to join');
    const found = await resolveInvite(ctx.db, c.req.param('token')!, ctx.now());
    if (!found) throw gone();
    const { capacity } = await placeOf(found.rec);
    const outcome = await joinReservation(ctx.db, found.rec, user, capacity, ctx.now());
    if (outcome === 'joined') metric('InviteJoins');
    return c.json({ joined: true, already: outcome === 'already' });
  });

  r.delete('/invites/:token/join', async (c) => {
    const user = c.get('user');
    if (!user) throw new AppError('UNAUTHORIZED', 'Sign in required');
    const found = await resolveInvite(ctx.db, c.req.param('token')!, ctx.now());
    if (!found) throw gone();
    await leaveReservation(ctx.db, found.rec, user.userId, user.displayAlias, ctx.now());
    return c.json({ joined: false });
  });

  /** Leave from My Reservations (attendees don't keep the token). Idempotent. */
  r.delete('/reservations/:id/attendance', async (c) => {
    const user = c.get('user');
    if (!user) throw new AppError('UNAUTHORIZED', 'Sign in required');
    const rec = await getReservation(ctx.db, c.req.param('id')!);
    if (!rec) throw new AppError('NOT_FOUND', 'Reservation not found');
    await leaveReservation(ctx.db, rec, user.userId, user.displayAlias, ctx.now());
    return c.json({ joined: false });
  });

  function ics(
    c: Context<Env>,
    rec: ReservationRecord,
    place: { roomName: string; buildingName: string },
    link: string,
  ) {
    const body = buildIcs({
      uid: `${rec.id}@freeroom`,
      sequence: rec.version,
      start: new Date(rec.start),
      end: new Date(rec.end),
      stamp: ctx.now(),
      summary: `Study session · ${place.roomName}`,
      location: `${place.roomName}, ${place.buildingName}, UMass Amherst`,
      description: `Join on FreeRoom: ${link}\nGet directions: ${link}${link.includes('?') ? '&' : '?'}directions=1\nFreeRoom bookings are informal and student-run.`,
      url: link,
      cancelled: !ACTIVE.includes(rec.status),
    });
    const file = place.roomName.replace(/[^A-Za-z0-9]+/g, '-');
    c.header('content-type', 'text/calendar; charset=utf-8');
    c.header('content-disposition', `attachment; filename="freeroom-${file}.ics"`);
    c.header('cache-control', 'no-store');
    return c.body(body);
  }

  r.get('/invites/:token/calendar.ics', async (c) => {
    const { rec, body } = await preview(c);
    return ics(c, rec, body, `${siteOrigin(c)}/i/${c.req.param('token')}`);
  });

  r.get('/reservations/:id/calendar.ics', async (c) => {
    const user = c.get('user');
    if (!user) throw new AppError('UNAUTHORIZED', 'Sign in required');
    const rec = await getReservation(ctx.db, c.req.param('id')!);
    if (!rec) throw new AppError('NOT_FOUND', 'Reservation not found');
    const isAttendee = (await listAttendees(ctx.db, rec.id)).some((a) => a.userId === user.userId);
    if (rec.ownerId !== user.userId && !isAttendee) {
      throw new AppError('NOT_FOUND', 'Reservation not found'); // no existence oracle
    }
    const place = await placeOf(rec);
    return ics(c, rec, place, `${siteOrigin(c)}/rooms/${encodeURIComponent(rec.roomId)}`);
  });

  return r;
}
