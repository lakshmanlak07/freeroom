/**
 * Mock 25Live endpoints + demo controls. Mounted only when explicitly enabled; createApp refuses
 * to enable them in prod (CLAUDE.md: never enable demo endpoints in prod).
 */
import { IsoDateTime } from '@freeroom/shared';
import { addDays, campusDay, campusDayStart, can } from '@freeroom/domain';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Ctx, Env } from '../app';
import { AppError, parse } from '../errors';
import { mockReservations, mockSpaces } from '../twentyfive/mock';
import { injectClass, loadInjected, syncSchedule } from '../sync/syncSchedule';

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

/** Demo Controls: "inject a class" → immediate sync of that room → BR-9 fires. Admin only. */
export function demoRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  r.post('/demo/inject-class', async (c) => {
    if (!can(c.get('user'), 'admin:forceRelease')) throw new AppError('FORBIDDEN', 'Admin only');
    const body = parse(InjectSchema, await c.req.json().catch(() => null));
    const start = new Date(body.start);
    const end = new Date(body.end);
    if (end <= start) throw new AppError('VALIDATION_ERROR', 'end must be after start');
    const eventId = await injectClass(ctx.db, { roomId: body.roomId, start, end, name: body.name });
    const summary = await syncSchedule(
      { db: ctx.db, source: ctx.source, now: ctx.now(), log: c.get('log') },
      {
        roomIds: [body.roomId],
        from: campusDayStart(campusDay(start)),
        to: campusDayStart(addDays(campusDay(end), 1)),
      },
    );
    return c.json({ eventId, sync: summary }, 201);
  });
  return r;
}
