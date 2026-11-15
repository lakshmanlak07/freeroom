import {
  DEFAULT_ROLE_LIMITS,
  addDays,
  campusDayStart,
  campusDaysOf,
  can,
  canConfirm,
  cutoffAt,
  initialStatusOnCreate,
  transitionReservation,
  validateReservationRequest,
  type ClassEvent,
  type Interval,
} from '@freeroom/domain';
import {
  CreateReservationRequestSchema,
  MyReservationsQuerySchema,
  type AlternativeRoom,
  type MyReservationsResponse,
  type ReservationEventsResponse,
} from '@freeroom/shared';
import { Hono } from 'hono';
import { createHash, randomUUID } from 'node:crypto';
import type { Ctx, Env } from '../app';
import {
  cancelReservation,
  confirmReservation,
  createReservation,
  getIdempotent,
  getReservation,
  listReservationEvents,
  listUserReservations,
  type ReservationRecord,
} from '../data/reservations';
import { getCatalog } from '../data/catalog';
import { getRoomDay } from '../data/schedule';
import { getUser, getUsers } from '../data/users';
import { AppError, parse } from '../errors';
import { metric } from '../metrics';
import { syncSchedule } from '../sync/syncSchedule';
import { UNKNOWN_OWNER, reservationDetail, reservationItem } from '../views';
import { listReservationClaims } from '../data/claims';
import { listAttendees, listJoined } from '../data/invites';

const STALE_MS = 15 * 60_000; // CLASS_CACHE_MAX_STALENESS
const FAIL_CLOSED_MS = 6 * 3_600_000; // §8.1: unreachable 25Live + data older than 6h → 503
const IDEMPOTENCY_KEY = /^[\w-]{8,128}$/;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** BR-1 at write time: classes for the room/days, refreshed on demand when stale (PRD §8.1). */
async function freshClasses(
  ctx: Ctx,
  roomId: string,
  iv: Interval,
  now: Date,
  log: Env['Variables']['log'],
) {
  const days = campusDaysOf(iv);
  const load = () => Promise.all(days.map((d) => getRoomDay(ctx.db, roomId, d)));
  let data = await load();
  const synced = data.map((d) => d.lastSyncedAt);
  const oldest = synced.includes(null) ? null : Math.min(...(synced as string[]).map(Date.parse));
  if (oldest === null || now.getTime() - oldest > STALE_MS) {
    try {
      await withTimeout(
        syncSchedule(
          { db: ctx.db, source: ctx.source, now, log },
          {
            roomIds: [roomId],
            from: campusDayStart(days[0]!),
            to: campusDayStart(addDays(days.at(-1)!, 1)),
          },
        ),
        ctx.refreshTimeoutMs,
      );
      data = await load();
    } catch (e) {
      log.warn('schedule.refresh_failed', { roomId, error: e });
      if (oldest === null || now.getTime() - oldest > FAIL_CLOSED_MS) {
        throw new AppError(
          'SCHEDULE_UNAVAILABLE',
          'Class schedule is unavailable; try again shortly',
        );
      }
    }
  }
  return data.flatMap((d) => d.classes) as ClassEvent[];
}

export function reservationRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const limits = ctx.limits ?? DEFAULT_ROLE_LIMITS;

  const load = async (id: string) => {
    const rec = await getReservation(ctx.db, id);
    if (!rec) throw new AppError('NOT_FOUND', 'Reservation not found');
    return rec;
  };
  const detail = async (rec: ReservationRecord, viewerId: string) =>
    reservationDetail(
      rec,
      (await getUser(ctx.db, rec.ownerId)) ?? UNKNOWN_OWNER,
      viewerId,
      ctx.now(),
    );

  r.post('/reservations', async (c) => {
    const user = c.get('user');
    const key = c.req.header('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header (8–128 chars) is required');
    }
    const body = parse(CreateReservationRequestSchema, await c.req.json().catch(() => null));
    const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior = await getIdempotent(ctx.db, user.userId, key);
    if (prior) {
      if (prior.requestHash !== requestHash) {
        throw new AppError('VALIDATION_ERROR', 'Idempotency-Key reused with a different request');
      }
      return c.json(prior.body as object, prior.status as 201);
    }

    const now = ctx.now();
    const iv = { start: new Date(body.start), end: new Date(body.end) };
    const room = (await getCatalog(ctx.db, now.getTime())).rooms.find(
      (x) => x.roomId === body.roomId,
    );
    if (!room) throw new AppError('NOT_FOUND', 'Room not found');
    if (body.partySize > room.capacity) {
      throw new AppError('VALIDATION_ERROR', 'Party size exceeds room capacity', {
        capacity: room.capacity,
      });
    }
    const vctx = { role: user.role, now, limits };
    const cheap = validateReservationRequest(
      { ...iv, roomId: room.roomId },
      { ...vctx, classes: [] },
    );
    if (!cheap.ok) throw new AppError(cheap.code, cheap.code, cheap.details);
    const classes = await freshClasses(ctx, room.roomId, iv, now, c.get('log'));
    const full = validateReservationRequest({ ...iv, roomId: room.roomId }, { ...vctx, classes });
    if (!full.ok) throw new AppError(full.code, 'A class is scheduled in this room', full.details);

    const status = initialStatusOnCreate(iv.start, now);
    const rec: ReservationRecord = {
      id: randomUUID(),
      roomId: room.roomId,
      ownerId: user.userId,
      start: iv.start.toISOString(),
      end: iv.end.toISOString(),
      partySize: body.partySize,
      ...(body.purpose ? { purpose: body.purpose } : {}),
      status,
      releaseReason: null,
      createdAt: now.toISOString(),
      cutoffAt: cutoffAt(iv.start).toISOString(),
      confirmedAt: status === 'CONFIRMED' ? now.toISOString() : null,
      version: 1,
    };
    const response = reservationDetail(rec, user, user.userId, now);
    const outcome = await createReservation(ctx.db, {
      rec,
      maxActive: limits[user.role].maxActive,
      idempotency: { userId: user.userId, key, requestHash, status: 201, body: response },
      now,
    });
    c.get('log').info('reservation.create', {
      reservationId: rec.id,
      roomId: rec.roomId,
      outcome: outcome.kind,
    });
    if (outcome.kind === 'created') metric('ReservationsCreated');
    return outcome.kind === 'created'
      ? c.json(response, 201)
      : c.json(outcome.body as object, outcome.status as 201);
  });

  /** Full detail for owner, claimants and admins; everyone else gets the public projection. */
  const canSeeDetail = async (rec: ReservationRecord, user: Env['Variables']['user']) =>
    rec.ownerId === user.userId ||
    can(user, 'admin:audit') ||
    (await listReservationClaims(ctx.db, rec.id)).some((x) => x.requesterId === user.userId);

  r.get('/reservations/:id', async (c) => {
    const user = c.get('user');
    const rec = await load(c.req.param('id'));
    if (await canSeeDetail(rec, user)) return c.json(await detail(rec, user.userId));
    const owner = (await getUser(ctx.db, rec.ownerId)) ?? UNKNOWN_OWNER;
    return c.json(reservationItem(rec, owner, user.userId, ctx.now()));
  });

  r.get('/me/reservations', async (c) => {
    const user = c.get('user');
    const { scope } = parse(MyReservationsQuerySchema, c.req.query());
    const now = ctx.now();
    const recs = await listUserReservations(ctx.db, user.userId, scope, now);
    if (!ctx.features?.invites) {
      const body: MyReservationsResponse = {
        reservations: recs.map((rec) => reservationDetail(rec, user, user.userId, now)),
      };
      return c.json(body);
    }
    // Invites: who's coming to mine, and the sessions I joined (aliases only).
    const joined = scope === 'upcoming' ? await listJoined(ctx.db, user.userId, now) : [];
    const owners = await getUsers(ctx.db, [...new Set(joined.map((r) => r.ownerId))]);
    const withPeople = async (rec: ReservationRecord, role: 'owner' | 'attendee') => ({
      ...reservationDetail(
        rec,
        role === 'owner' ? user : (owners.get(rec.ownerId) ?? UNKNOWN_OWNER),
        user.userId,
        now,
      ),
      role,
      attendees: (await listAttendees(ctx.db, rec.id)).map((x) => ({ alias: x.alias })),
    });
    const all = await Promise.all([
      ...recs.map((rec) => withPeople(rec, 'owner')),
      ...joined.map((rec) => withPeople(rec, 'attendee')),
    ]);
    all.sort((x, y) => x.start.localeCompare(y.start));
    const body: MyReservationsResponse = { reservations: all };
    return c.json(body);
  });

  r.post('/reservations/:id/confirm', async (c) => {
    const user = c.get('user');
    const rec = await load(c.req.param('id'));
    if (rec.ownerId !== user.userId) throw new AppError('FORBIDDEN', 'Only the owner can confirm');
    const check = (x: ReservationRecord, now: Date) => {
      const v = canConfirm({ status: x.status, start: new Date(x.start) }, now);
      if (!v.ok) throw new AppError(v.code, v.code);
    };
    check(rec, ctx.now());
    // Server clock inside the conditional write (BR-6).
    const now = ctx.now();
    if (!(await confirmReservation(ctx.db, rec, now))) {
      check(await load(rec.id), now);
      throw new AppError('INVALID_TRANSITION', 'Reservation changed; reload');
    }
    return c.json(await detail(await load(rec.id), user.userId));
  });

  r.delete('/reservations/:id', async (c) => {
    const user = c.get('user');
    const rec = await load(c.req.param('id'));
    if (!can(user, 'reservation:cancel', { ownerId: rec.ownerId })) {
      throw new AppError('FORBIDDEN', 'Only the owner can cancel');
    }
    const t = transitionReservation(rec.status, 'CANCEL');
    if (!t.ok || !(await cancelReservation(ctx.db, rec, user.userId, ctx.now()))) {
      throw new AppError('INVALID_TRANSITION', `Reservation is ${rec.status}`);
    }
    return c.json(await detail(await load(rec.id), user.userId));
  });

  r.get('/reservations/:id/events', async (c) => {
    const user = c.get('user');
    const rec = await load(c.req.param('id'));
    if (!(await canSeeDetail(rec, user))) {
      throw new AppError('FORBIDDEN', 'Not allowed');
    }
    const events = await listReservationEvents(ctx.db, rec.id);
    const actors = await getUsers(
      ctx.db,
      events.flatMap((e) => (e.actorId ? [e.actorId] : [])),
    );
    const body: ReservationEventsResponse = {
      events: events.map((e) => ({
        eventId: e.eventId,
        type: e.type,
        at: e.at,
        actorAlias: e.actorId
          ? (actors.get(e.actorId)?.displayAlias ?? UNKNOWN_OWNER.displayAlias)
          : null,
        ...(e.reason ? { reason: e.reason } : {}),
        // Allowlist: only class details + alternatives leave the server (no user ids).
        ...(e.data?.class || e.data?.alternatives
          ? {
              details: {
                ...(e.data.class ? { class: e.data.class as Record<string, unknown> } : {}),
                ...(e.data.alternatives
                  ? { alternatives: e.data.alternatives as AlternativeRoom[] }
                  : {}),
              },
            }
          : {}),
      })),
    };
    return c.json(body);
  });

  return r;
}
