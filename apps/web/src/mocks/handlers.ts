/** MSW handlers implementing the PRD §7 contract over in-memory data, using the real domain rules. */
import {
  ACTIVE_RESERVATION_STATUSES,
  DEFAULT_ROLE_LIMITS,
  addDays,
  campusDay,
  campusDayStart,
  campusDaysOf,
  canSubmitClaim,
  checkQuota,
  cutoffAt,
  initialStatusOnCreate,
  isClaimable,
  overlaps,
  toReservationItem,
  validateReservationRequest,
} from '@freeroom/domain';
import type { ErrorCode, ReservationDetail, RoomStatus } from '@freeroom/shared';
import { delay, http, HttpResponse } from 'msw';
import { BUILDINGS, ROOMS, classesFor, db, type MockReservation } from './data';
import { trackClaim } from './handlersP6';

const err = (status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  HttpResponse.json({ error: { code, message, ...(details && { details }) } }, { status });
const iv = (x: { start: string | Date; end: string | Date }) => ({
  start: new Date(x.start),
  end: new Date(x.end),
});
const active = (r: MockReservation) => ACTIVE_RESERVATION_STATUSES.includes(r.status);
const userOf = (req: Request) => req.headers.get('x-dev-user');
const alias = (id: string) =>
  db.registered.get(id) ?? { displayAlias: 'A FreeRoom user', role: 'STUDENT' as const };

function classesBetween(roomId: string, from: Date, to: Date) {
  const room = ROOMS.find((r) => r.roomId === roomId)!;
  return campusDaysOf({ start: from, end: to }).flatMap((d) => classesFor(room, d));
}

function detail(r: MockReservation, viewer: string, now: Date): ReservationDetail {
  const item = toReservationItem({ ...r, ...iv(r) }, alias(r.ownerId), viewer, now);
  return {
    id: item.id,
    roomId: item.roomId,
    start: item.start,
    end: item.end,
    status: item.status,
    ownerAlias: item.ownerAlias,
    isMine: item.isMine,
    claimable: item.claimable,
    partySize: r.partySize,
    ...(r.purpose ? { purpose: r.purpose } : {}),
    cutoffAt: r.cutoffAt,
    confirmedAt: r.confirmedAt,
    createdAt: r.createdAt,
    releaseReason: null,
  };
}

function statusAt(
  roomId: string,
  t: Date,
  now: Date,
): { status: RoomStatus; freeUntil: string | null } {
  const day = campusDay(t);
  const dayEnd = campusDayStart(addDays(day, 1));
  const at = { start: t, end: new Date(t.getTime() + 1) };
  const cls = classesBetween(roomId, campusDayStart(day), dayEnd);
  if (cls.some((c) => overlaps(iv(c), at))) return { status: 'CLASS_IN_PROGRESS', freeUntil: null };
  const res = db.reservations.filter((r) => r.roomId === roomId && active(r));
  const holding = res.find((r) => overlaps(iv(r), at));
  if (holding) {
    return {
      status: isClaimable({ status: holding.status, start: new Date(holding.start) }, now)
        ? 'RESERVED_CLAIMABLE'
        : 'RESERVED',
      freeUntil: null,
    };
  }
  const next = [...cls, ...res]
    .map((x) => new Date(x.start).getTime())
    .filter((s) => s > t.getTime())
    .sort((a, b) => a - b)[0];
  return {
    status: 'FREE',
    freeUntil: new Date(Math.min(next ?? Infinity, dayEnd.getTime())).toISOString(),
  };
}

const busyDuring = (roomId: string, from: Date, to: Date) =>
  classesBetween(roomId, from, to).some((c) => overlaps(iv(c), { start: from, end: to })) ||
  db.reservations.some(
    (r) => r.roomId === roomId && active(r) && overlaps(iv(r), { start: from, end: to }),
  );

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ ok: true })),

  http.get('*/buildings', async () => {
    await delay(200);
    const now = new Date();
    return HttpResponse.json({
      buildings: BUILDINGS.map((b) => {
        const rooms = ROOMS.filter((r) => r.buildingId === b.buildingId);
        const free = rooms.filter((r) => statusAt(r.roomId, now, now).status === 'FREE').length;
        return { ...b, roomCount: rooms.length, freePct: Math.round((100 * free) / rooms.length) };
      }),
    });
  }),

  // Mock-only stand-in for natural-language search (the real parser/Bedrock live in the API).
  http.post('*/rooms/search/natural', async ({ request }) => {
    await delay(400);
    const { query } = (await request.json()) as { query: string };
    const t = query.toLowerCase();
    const cap = t.match(/\bfor (\d{1,3})\b|(\d{1,3}) people/);
    const equipment = (
      ['projector', 'whiteboard', 'computers', 'outlets', 'accessible'] as const
    ).filter((e) => t.includes(e.replace(/s$/, '')));
    const building = t.includes('library') ? 'DUBOIS' : t.includes('lgrt') ? 'LGRT' : undefined;
    const filters = {
      ...(building && { building }),
      ...(cap && { minCapacity: Number(cap[1] ?? cap[2]) }),
      ...(equipment.length && { equipment: [...equipment] }),
      ...(/\bnow\b/.test(t) && { freeNow: true }),
    };
    return HttpResponse.json({ filters, rooms: [], source: 'parser' });
  }),

  http.get('*/rooms', async ({ request }) => {
    await delay(300);
    const q = new URL(request.url).searchParams;
    const now = new Date();
    const t = q.get('freeFrom') ? new Date(q.get('freeFrom')!) : now;
    const until = q.get('freeTo') ? new Date(q.get('freeTo')!) : undefined;
    const equipment = (q.get('equipment') ?? '').split(',').filter(Boolean);
    let rooms = ROOMS.filter(
      (r) =>
        (!q.get('building') || r.buildingId === q.get('building')) &&
        r.capacity >= Number(q.get('minCapacity') ?? 0) &&
        equipment.every((e) => r.equipment.includes(e as never)),
    ).map((r) => ({ ...r, ...statusAt(r.roomId, t, now) }));
    if (q.get('freeNow') === 'true') rooms = rooms.filter((r) => r.status === 'FREE');
    if (until) rooms = rooms.filter((r) => !busyDuring(r.roomId, t, until));
    const free = (x: { freeUntil: string | null }) => (x.freeUntil ? Date.parse(x.freeUntil) : 0);
    const sort = q.get('sort') ?? 'soonestFree';
    rooms.sort((a, b) =>
      sort === 'capacity'
        ? a.capacity - b.capacity
        : sort === 'longestFree'
          ? free(b) - free(a)
          : Number(a.status !== 'FREE') - Number(b.status !== 'FREE') ||
            a.name.localeCompare(b.name),
    );
    return HttpResponse.json({ rooms });
  }),

  http.get('*/rooms/:roomId/schedule', async ({ request, params }) => {
    await delay(250);
    const room = ROOMS.find((r) => r.roomId === params.roomId);
    if (!room) return err(404, 'NOT_FOUND', 'Room not found');
    const q = new URL(request.url).searchParams;
    const from = new Date(q.get('from')!);
    const to = new Date(q.get('to')!);
    const now = new Date();
    const viewer = userOf(request) ?? '';
    const items = [
      ...classesBetween(room.roomId, from, to).filter((c) =>
        overlaps(iv(c), { start: from, end: to }),
      ),
      ...db.reservations
        .filter(
          (r) => r.roomId === room.roomId && active(r) && overlaps(iv(r), { start: from, end: to }),
        )
        .map((r) => toReservationItem({ ...r, ...iv(r) }, alias(r.ownerId), viewer, now)),
    ].sort((a, b) => a.start.localeCompare(b.start));
    return HttpResponse.json({ items, staleness: { lastSyncedAt: db.lastSyncedAt } });
  }),

  http.get('*/rooms/:roomId', ({ params }) => {
    const room = ROOMS.find((r) => r.roomId === params.roomId);
    return room ? HttpResponse.json(room) : err(404, 'NOT_FOUND', 'Room not found');
  }),

  http.get('*/me', ({ request }) => {
    const u = userOf(request);
    if (!u) return err(401, 'UNAUTHORIZED', 'Sign in required');
    const me = db.registered.get(u);
    return me ? HttpResponse.json(me) : err(404, 'NOT_FOUND', 'Not registered');
  }),

  http.post('*/register', async ({ request }) => {
    const u = userOf(request);
    if (!u) return err(401, 'UNAUTHORIZED', 'Sign in required');
    const b = (await request.json()) as {
      displayAlias: string;
      shareChannel: 'email' | 'phone';
      contact: { email?: string; phone?: string };
    };
    if ([...db.registered.values()].length > 50) return err(429, 'RATE_LIMITED', 'Slow down');
    const me = {
      userId: u,
      role: 'STUDENT' as const,
      displayAlias: b.displayAlias,
      shareChannel: b.shareChannel,
      contact: b.contact,
    };
    db.registered.set(u, me);
    return HttpResponse.json(
      { userId: u, role: me.role, displayAlias: me.displayAlias, shareChannel: me.shareChannel },
      { status: 201 },
    );
  }),

  http.post('*/reservations', async ({ request }) => {
    await delay(400);
    const u = userOf(request);
    const me = u && db.registered.get(u);
    if (!me) return err(401, 'UNAUTHORIZED', 'Sign in required');
    const key = request.headers.get('idempotency-key');
    if (!key) return err(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
    const body = (await request.json()) as {
      roomId: string;
      start: string;
      end: string;
      partySize: number;
      purpose?: string;
    };
    const bodyHash = JSON.stringify(body);
    const prior = db.idempotency.get(`${u}:${key}`);
    if (prior)
      return prior.hash === bodyHash
        ? HttpResponse.json(prior.body, { status: 201 })
        : err(400, 'VALIDATION_ERROR', 'Idempotency-Key reused');
    const room = ROOMS.find((r) => r.roomId === body.roomId);
    if (!room) return err(404, 'NOT_FOUND', 'Room not found');
    const now = new Date();
    const r = iv(body);
    const classes = classesBetween(room.roomId, r.start, r.end).map((c) => ({ ...c, ...iv(c) }));
    const v = validateReservationRequest(
      { ...r, roomId: room.roomId },
      { role: me.role, now, classes },
    );
    if (!v.ok)
      return err(
        v.code === 'CLASS_CONFLICT' ? 409 : 400,
        v.code,
        v.code === 'CLASS_CONFLICT' ? 'A class is scheduled in this room' : v.code,
        v.details,
      );
    if (db.reservations.some((x) => x.roomId === room.roomId && active(x) && overlaps(iv(x), r))) {
      return err(409, 'SLOT_TAKEN', 'That time is already reserved');
    }
    const mine = db.reservations.filter(
      (x) => x.ownerId === u && active(x) && new Date(x.end) > now,
    ).length;
    const q = checkQuota(me.role, mine);
    if (!q.ok)
      return err(429, 'QUOTA_EXCEEDED', 'Active reservation limit reached', {
        maxActive: DEFAULT_ROLE_LIMITS[me.role].maxActive,
      });
    const status = initialStatusOnCreate(r.start, now);
    const rec: MockReservation = {
      id: crypto.randomUUID(),
      roomId: room.roomId,
      ownerId: u,
      start: r.start.toISOString(),
      end: r.end.toISOString(),
      partySize: body.partySize,
      ...(body.purpose ? { purpose: body.purpose } : {}),
      status,
      createdAt: now.toISOString(),
      cutoffAt: cutoffAt(r.start).toISOString(),
      confirmedAt: status === 'CONFIRMED' ? now.toISOString() : null,
    };
    db.reservations.push(rec);
    const out = detail(rec, u, now);
    db.idempotency.set(`${u}:${key}`, { hash: bodyHash, body: out });
    return HttpResponse.json(out, { status: 201 });
  }),

  http.get('*/reservations/:id', ({ request, params }) => {
    const r = db.reservations.find((x) => x.id === params.id);
    return r
      ? HttpResponse.json(detail(r, userOf(request) ?? '', new Date()))
      : err(404, 'NOT_FOUND', 'Reservation not found');
  }),

  http.get('*/me/reservations', ({ request }) => {
    const u = userOf(request) ?? '';
    const now = new Date();
    const upcoming = new URL(request.url).searchParams.get('scope') !== 'past';
    const list = db.reservations.filter(
      (r) => r.ownerId === u && (upcoming ? new Date(r.end) > now : new Date(r.end) <= now),
    );
    return HttpResponse.json({ reservations: list.map((r) => detail(r, u, now)) });
  }),

  http.post('*/reservations/:id/claims', async ({ request, params }) => {
    await delay(300);
    const u = userOf(request);
    if (!u || !db.registered.get(u)) return err(401, 'UNAUTHORIZED', 'Sign in required');
    const r = db.reservations.find((x) => x.id === params.id);
    if (!r) return err(404, 'NOT_FOUND', 'Reservation not found');
    const now = new Date();
    const v = canSubmitClaim({ ...r, start: new Date(r.start) }, u, now);
    if (!v.ok) return err(v.code === 'OWN_RESERVATION' ? 400 : 409, v.code, v.code);
    if (db.claims.some((c) => c.reservationId === r.id && c.requesterId === u))
      return err(409, 'CLAIM_EXISTS', 'You already asked for this room');
    const b = (await request.json()) as { message?: string; partySize: number };
    const claimId = `${r.id}_${crypto.randomUUID()}`;
    db.claims.push({ claimId, reservationId: r.id, requesterId: u });
    trackClaim({
      claimId,
      reservationId: r.id,
      requesterId: u,
      ownerId: r.ownerId,
      ...(b.message ? { message: b.message } : {}),
      partySize: b.partySize,
      createdAt: now.toISOString(),
      expiresAt: r.cutoffAt,
    });
    return HttpResponse.json(
      {
        claimId,
        reservationId: r.id,
        status: 'PENDING',
        mode: null,
        ...(b.message ? { message: b.message } : {}),
        partySize: b.partySize,
        requesterAlias: alias(u).displayAlias,
        ownerAlias: alias(r.ownerId).displayAlias,
        createdAt: now.toISOString(),
        expiresAt: r.cutoffAt,
      },
      { status: 201 },
    );
  }),

  http.get('*/me/notifications', ({ request }) => {
    const u = userOf(request) ?? '';
    return HttpResponse.json({ notifications: db.notifications.get(u) ?? [], nextCursor: null });
  }),
];
