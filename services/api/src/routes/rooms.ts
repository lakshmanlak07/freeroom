import {
  ACTIVE_RESERVATION_STATUSES,
  addDays,
  campusDay,
  campusDayStart,
  campusDaysOf,
  overlaps,
} from '@freeroom/domain';
import {
  NaturalSearchRequestSchema,
  RoomSearchQuerySchema,
  ScheduleQuerySchema,
  type BuildingsResponse,
  type NaturalSearchResponse,
  type RoomSearchQuery,
  type RoomSearchResponse,
  type ScheduleResponse,
} from '@freeroom/shared';
import { Hono } from 'hono';
import { isFreeDuring, loadBusy, statusAt } from '../availability';
import type { Ctx, Env } from '../app';

const NL_PER_MINUTE = 10;
import { getCatalog } from '../data/catalog';
import { asInterval, listRoomReservations } from '../data/reservations';
import { getRoomDay } from '../data/schedule';
import { getUsers, takeNlSearchToken } from '../data/users';
import { metric } from '../metrics';
import { understand } from '../nlsearch';
import { AppError, parse } from '../errors';
import { UNKNOWN_OWNER, classItem, publicRoom, reservationItem } from '../views';

const MAX_SCHEDULE_DAYS = 14;

/** GET /rooms filtering + status, shared with natural-language search. */
async function searchRooms(ctx: Ctx, q: RoomSearchQuery) {
  const now = ctx.now();
  const t = q.freeFrom ? new Date(q.freeFrom) : now;
  const until = q.freeTo ? new Date(q.freeTo) : undefined;
  if (until && !q.freeFrom) throw new AppError('VALIDATION_ERROR', 'freeTo requires freeFrom');
  if (until && (until <= t || until.getTime() - t.getTime() > 24 * 3_600_000)) {
    throw new AppError('VALIDATION_ERROR', 'freeTo must be after freeFrom and within 24h');
  }
  const { rooms } = await getCatalog(ctx.db, now.getTime());
  const matching = rooms.filter(
    (x) =>
      (!q.building || x.buildingId === q.building) &&
      (!q.minCapacity || x.capacity >= q.minCapacity) &&
      (q.equipment ?? []).every((e) => x.equipment.includes(e)),
  );
  const days = campusDaysOf({ start: t, end: until ?? new Date(t.getTime() + 1) });
  const dayEnd = campusDayStart(addDays(campusDay(t), 1));
  const busy = await loadBusy(
    ctx.db,
    matching.map((x) => x.roomId),
    days,
    now.getTime(),
  );
  let results = matching.map((x) => {
    const b = busy.get(x.roomId)!;
    return { room: publicRoom(x), b, ...statusAt(b, t, now, dayEnd) };
  });
  if (q.freeNow) results = results.filter((x) => x.status === 'FREE');
  if (until) results = results.filter((x) => isFreeDuring(x.b, { start: t, end: until }));

  const freeMs = (x: (typeof results)[number]) => (x.freeUntil ? Date.parse(x.freeUntil) : 0);
  const sorters = {
    soonestFree: (a: (typeof results)[number], b: (typeof results)[number]) =>
      Number(a.status !== 'FREE') - Number(b.status !== 'FREE') ||
      a.room.name.localeCompare(b.room.name),
    longestFree: (a: (typeof results)[number], b: (typeof results)[number]) =>
      freeMs(b) - freeMs(a),
    capacity: (a: (typeof results)[number], b: (typeof results)[number]) =>
      a.room.capacity - b.room.capacity,
    // TODO(P5): distance needs the viewer's location (client-side sort; never sent to the server).
    distance: (a: (typeof results)[number], b: (typeof results)[number]) =>
      a.room.name.localeCompare(b.room.name),
  };
  results.sort(sorters[q.sort ?? 'soonestFree']);
  return results.map(({ room, status, freeUntil }) => ({ ...room, status, freeUntil }));
}

export function roomRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get('/buildings', async (c) => {
    const now = ctx.now();
    const { buildings, rooms } = await getCatalog(ctx.db, now.getTime());
    const day = campusDay(now);
    const dayEnd = campusDayStart(addDays(day, 1));
    const busy = await loadBusy(
      ctx.db,
      rooms.map((x) => x.roomId),
      [day],
      now.getTime(),
    );
    const body: BuildingsResponse = {
      buildings: buildings.map((b) => {
        const inB = rooms.filter((x) => x.buildingId === b.buildingId);
        const free = inB.filter(
          (x) => statusAt(busy.get(x.roomId)!, now, now, dayEnd).status === 'FREE',
        ).length;
        return {
          ...b,
          roomCount: inB.length,
          freePct: inB.length ? Math.round((100 * free) / inB.length) : 0,
        };
      }),
    };
    return c.json(body);
  });

  r.get('/rooms', async (c) => {
    const q = parse(RoomSearchQuerySchema, c.req.query());
    const body: RoomSearchResponse = { rooms: await searchRooms(ctx, q) };
    return c.json(body);
  });

  /** F1 stretch: free text → filters (Bedrock or parser) → the same deterministic search. */
  r.post('/rooms/search/natural', async (c) => {
    const { query } = parse(NaturalSearchRequestSchema, await c.req.json().catch(() => null));
    const now = ctx.now();
    if (!(await takeNlSearchToken(ctx.db, c.get('user').userId, now, NL_PER_MINUTE))) {
      throw new AppError('RATE_LIMITED', `At most ${NL_PER_MINUTE} searches a minute`);
    }
    const { buildings } = await getCatalog(ctx.db, now.getTime());
    const { filters, source } = await understand(
      query,
      { now, buildings },
      ctx.nlBedrock,
      c.get('log'),
    );
    metric('NLSearchSource', 1, 'Count', { Source: source });
    const body: NaturalSearchResponse = {
      filters,
      rooms: await searchRooms(ctx, filters),
      source,
    };
    return c.json(body);
  });

  r.get('/rooms/:roomId', async (c) => {
    const room = (await getCatalog(ctx.db, ctx.now().getTime())).rooms.find(
      (x) => x.roomId === c.req.param('roomId'),
    );
    if (!room) throw new AppError('NOT_FOUND', 'Room not found');
    return c.json(publicRoom(room));
  });

  r.get('/rooms/:roomId/schedule', async (c) => {
    const q = parse(ScheduleQuerySchema, c.req.query());
    const iv = { start: new Date(q.from), end: new Date(q.to) };
    if (
      iv.end <= iv.start ||
      iv.end.getTime() - iv.start.getTime() > MAX_SCHEDULE_DAYS * 86_400_000
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Range must be positive and at most ${MAX_SCHEDULE_DAYS} days`,
      );
    }
    const now = ctx.now();
    const room = (await getCatalog(ctx.db, now.getTime())).rooms.find(
      (x) => x.roomId === c.req.param('roomId'),
    );
    if (!room) throw new AppError('NOT_FOUND', 'Room not found');
    const days = campusDaysOf(iv);
    const [dayData, reservations] = await Promise.all([
      Promise.all(days.map((d) => getRoomDay(ctx.db, room.roomId, d))),
      listRoomReservations(ctx.db, room.roomId, [addDays(days[0]!, -1), ...days]),
    ]);
    const active = reservations.filter(
      (x) => ACTIVE_RESERVATION_STATUSES.includes(x.status) && overlaps(asInterval(x), iv),
    );
    const owners = await getUsers(
      ctx.db,
      active.map((x) => x.ownerId),
    );
    const viewer = (c.get('user') as Env['Variables']['user'] | undefined)?.userId ?? ''; // '' = anonymous
    const synced = dayData.map((d) => d.lastSyncedAt);
    const body: ScheduleResponse = {
      items: [
        ...dayData.flatMap((d) =>
          d.classes.filter((x) => overlaps(x, iv)).map((x) => classItem(x, room)),
        ),
        ...active.map((x) =>
          reservationItem(x, owners.get(x.ownerId) ?? UNKNOWN_OWNER, viewer, now),
        ),
      ].sort((a, b) => a.start.localeCompare(b.start)),
      staleness: { lastSyncedAt: synced.includes(null) ? null : (synced as string[]).sort()[0]! },
    };
    return c.json(body);
  });

  return r;
}
