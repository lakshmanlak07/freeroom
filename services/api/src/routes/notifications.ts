import { MarkReadRequestSchema, NotificationsQuerySchema } from '@freeroom/shared';
import { Hono } from 'hono';
import type { Ctx, Env } from '../app';
import { listNotifications, markRead } from '../data/notifications';
import { parse } from '../errors';

export function notificationRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  r.get('/me/notifications', async (c) => {
    const { cursor } = parse(NotificationsQuerySchema, c.req.query());
    return c.json(await listNotifications(ctx.db, c.get('user').userId, cursor));
  });
  r.post('/me/notifications/read', async (c) => {
    const body = parse(MarkReadRequestSchema, await c.req.json().catch(() => null));
    const updated = await markRead(ctx.db, c.get('user').userId, 'all' in body ? 'all' : body.ids);
    return c.json({ updated });
  });
  return r;
}
