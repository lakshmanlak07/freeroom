/**
 * Mock 25Live endpoints + Demo Controls. Mounted only when DEMO_MODE is on; createApp refuses to
 * enable them in prod (CLAUDE.md: never enable demo endpoints in prod). Demo routes are admin-only.
 */
import { ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { IsoDateTime } from '@freeroom/shared';
import { addDays, campusDay, campusDayStart, can } from '@freeroom/domain';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Ctx, Env } from '../app';
import { clearBusyCache } from '../availability';
import type { Item } from '../data/db';
import { keys } from '../data/keys';
import { getReservation } from '../data/reservations';
import { getDemoIds, seedDemo } from '../demoSeed';
import { AppError, parse } from '../errors';
import { sweep } from '../sweeper';
import { injectClass, loadInjected, syncSchedule } from '../sync/syncSchedule';
import { mockReservations, mockSpaces } from '../twentyfive/mock';

/** Serves the seeded campus in raw 25Live JSON shape (what RealTwentyFiveLiveSource parses). */
export function mock25liveRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  r.get('/spaces.json', (c) => c.json({ spaces: { space: mockSpaces() } }));
  r.get('/reservations.json', async (c) => {
    const q = parse(
      z.object({ space_id: z.coerce.number().int(), start_dt: IsoDateTime, end_dt: IsoDateTime }),
      c.req.query(),
    );
    const from = new Date(q.start_dt);
    const to = new Date(q.end_dt);
    if (to <= from || to.getTime() - from.getTime() > 31 * 86_400_000) {
      throw new AppError('VALIDATION_ERROR', 'Bad range');
    }
    const all = [...mockReservations(from, to), ...(await loadInjected(ctx.db))];
    return c.json({ reservations: { reservation: all.filter((x) => x.space_id === q.space_id) } });
  });
  return r;
}

const InjectSchema = z.object({
  roomId: z.string().min(1).max(64),
  start: IsoDateTime,
  end: IsoDateTime,
  name: z.string().trim().min(1).max(120).default('COMPSCI 999-01: Surprise Review Session'),
});
const ByReservation = z.object({ reservationId: z.string().min(1).max(128) });

const adminOnly = (c: Context<Env>) => {
  if (!can(c.get('user'), 'admin:forceRelease')) throw new AppError('FORBIDDEN', 'Admin only');
};
const body = async (c: Context<Env>) => c.req.json().catch(() => null);

export function demoRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  const injectAndSync = async (
    c: Context<Env>,
    roomId: string,
    start: Date,
    end: Date,
    name: string,
  ) => {
    const eventId = await injectClass(ctx.db, { roomId, start, end, name });
    const summary = await syncSchedule(
      { db: ctx.db, source: ctx.source, now: ctx.now(), log: c.get('log') },
      {
        roomIds: [roomId],
        from: campusDayStart(campusDay(start)),
        to: campusDayStart(addDays(campusDay(end), 1)),
      },
    );
    clearBusyCache();
    return { eventId, sync: summary };
  };

  r.post('/demo/inject-class', async (c) => {
    adminOnly(c);
    const b = parse(InjectSchema, await body(c));
    const start = new Date(b.start);
    const end = new Date(b.end);
    if (end <= start) throw new AppError('VALIDATION_ERROR', 'end must be after start');
    return c.json(await injectAndSync(c, b.roomId, start, end, b.name), 201);
  });

  /** BR-9 demo: a class lands exactly on this reservation → released with 3 alternatives. */
  r.post('/demo/inject-conflict', async (c) => {
    adminOnly(c);
    const { reservationId } = parse(ByReservation, await body(c));
    const res = await getReservation(ctx.db, reservationId);
    if (!res) throw new AppError('NOT_FOUND', 'Reservation not found');
    const out = await injectAndSync(
      c,
      res.roomId,
      new Date(res.start),
      new Date(res.end),
      'DEMO 101-01: Pop-up Lecture',
    );
    const after = await getReservation(ctx.db, reservationId);
    return c.json({ ...out, status: after?.status, releaseReason: after?.releaseReason }, 201);
  });

  /** BR-6 demo: run the sweeper for this reservation as if it were its cutoff now. */
  r.post('/demo/fast-forward', async (c) => {
    adminOnly(c);
    const { reservationId } = parse(ByReservation, await body(c));
    const res = await getReservation(ctx.db, reservationId);
    if (!res) throw new AppError('NOT_FOUND', 'Reservation not found');
    const result = await sweep(ctx.db, new Date(res.cutoffAt), { reservationId });
    clearBusyCache();
    const after = await getReservation(ctx.db, reservationId);
    return c.json({ ...result, status: after?.status, releaseReason: after?.releaseReason });
  });

  /** Wipe reservations/claims/notifications/injected classes, resync, then re-seed the demo. */
  r.post('/demo/reset', async (c) => {
    adminOnly(c);
    const doomed: Item[] = [];
    let start: Item | undefined;
    do {
      const page = await ctx.db.doc.send(
        new ScanCommand({
          TableName: ctx.db.table,
          ExclusiveStartKey: start,
          ProjectionExpression: 'PK, SK, kind',
        }),
      );
      for (const i of page.Items ?? []) {
        const pk = String(i.PK);
        const sk = String(i.SK);
        if (
          pk.startsWith(keys.prefix.res) ||
          pk.startsWith(keys.prefix.idemp) ||
          pk === keys.injectedPk ||
          sk === keys.quota('x').SK ||
          sk === keys.claimQuota('x').SK ||
          sk.startsWith(keys.prefix.notif) ||
          (sk === keys.lock('x', 'x').SK && i.kind === 'reservation')
        ) {
          doomed.push({ PK: i.PK, SK: i.SK });
        }
      }
      start = page.LastEvaluatedKey as Item | undefined;
    } while (start);
    for (let i = 0; i < doomed.length; i += 25) {
      await ctx.db.doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [ctx.db.table]: doomed.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
          },
        }),
      );
    }
    const sync = await syncSchedule({
      db: ctx.db,
      source: ctx.source,
      now: ctx.now(),
      log: c.get('log'),
    });
    const seeded = await seedDemo(ctx.db, await getDemoIds(ctx.db), ctx.now());
    clearBusyCache();
    return c.json({ deleted: doomed.length, sync, seeded });
  });
  return r;
}
