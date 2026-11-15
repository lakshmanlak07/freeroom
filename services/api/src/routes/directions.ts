/**
 * GET /rooms/:roomId/route — "Get me there" (feature flag `features.directions`).
 * Privacy: the origin is rounded to ~10 m before routing, used once, never stored, never logged
 * (the request log records the path only; the query string is not logged anywhere).
 */
import {
  ACTIVE_RESERVATION_STATUSES,
  arrivalVerdict,
  campusDay,
  type ScheduleBlock,
} from '@freeroom/domain';
import { RouteQuerySchema, type LatLng, type RouteResponse } from '@freeroom/shared';
import { Hono } from 'hono';
import type { Ctx, Env } from '../app';
import { getCatalog } from '../data/catalog';
import { listRoomReservations } from '../data/reservations';
import { getRoomDay } from '../data/schedule';
import { takeRateToken } from '../data/users';
import { RouteCache, roundLatLng, type WalkLeg } from '../directions/router';
import { AppError, parse } from '../errors';
import { metric } from '../metrics';
import { ENTRANCES } from '../twentyfive/campus';

export const ROUTES_PER_MINUTE = 20;

export function directionsRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  const cache = ctx.routeCache ?? new RouteCache();

  r.get('/rooms/:roomId/route', async (c) => {
    const user = c.get('user');
    if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to get directions');
    if (!ctx.router) throw new AppError('ROUTING_UNAVAILABLE', 'Directions are not available');
    const q = parse(RouteQuerySchema, c.req.query());
    const now = ctx.now();
    if (!(await takeRateToken(ctx.db, user.userId, 'route', now, ROUTES_PER_MINUTE, 'minute'))) {
      throw new AppError('RATE_LIMITED', 'Lots of route requests — wait a minute and try again');
    }

    const { rooms, buildings } = await getCatalog(ctx.db, now.getTime());
    const room = rooms.find((x) => x.roomId === c.req.param('roomId'));
    if (!room) throw new AppError('NOT_FOUND', 'Room not found');
    const accessible = q.accessible === 'true';

    let origin: LatLng;
    if (q.from.startsWith('building:')) {
      const id = q.from.slice('building:'.length);
      const b = buildings.find((x) => x.buildingId === id);
      if (!b) throw new AppError('NOT_FOUND', 'Building not found');
      const door = ENTRANCES[id]?.main;
      origin = door ? { lat: door.lat, lng: door.lng } : { lat: b.lat, lng: b.lng };
    } else {
      const [lat, lng] = q.from.split(',').map(Number) as [number, number];
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new AppError('VALIDATION_ERROR', 'Invalid location');
      }
      origin = roundLatLng({ lat, lng });
    }

    const building = buildings.find((x) => x.buildingId === room.buildingId);
    const door = ENTRANCES[room.buildingId]?.[accessible ? 'accessible' : 'main'];
    const destination = door
      ? { lat: door.lat, lng: door.lng, label: door.label }
      : { lat: room.lat, lng: room.lng, label: building?.name ?? room.buildingId };

    const key = `${origin.lat},${origin.lng}|${room.roomId}|${accessible}`;
    let leg: WalkLeg | undefined = cache.get(key, now.getTime());
    if (!leg) {
      try {
        leg = await ctx.router.walk(origin, destination);
      } catch (e) {
        c.get('log').warn('route.failed', { error: (e as Error).name }); // never the coordinates
        metric('RouteFailures');
        throw new AppError('ROUTING_UNAVAILABLE', 'Couldn’t get directions right now');
      }
      cache.set(key, leg, now.getTime());
    }

    const arriveAt = new Date(now.getTime() + leg.durationSeconds * 1000);
    const day = campusDay(arriveAt);
    const [{ classes }, reservations] = await Promise.all([
      getRoomDay(ctx.db, room.roomId, day),
      listRoomReservations(ctx.db, room.roomId, [day]),
    ]);
    const blocks: ScheduleBlock[] = [
      ...classes.map((x) => ({
        kind: 'class' as const,
        name: x.courseCode ?? x.name,
        start: x.start,
        end: x.end,
      })),
      ...reservations
        .filter((x) => ACTIVE_RESERVATION_STATUSES.includes(x.status))
        .map((x) => ({
          kind: 'reservation' as const,
          isMine: x.ownerId === user.userId,
          start: new Date(x.start),
          end: new Date(x.end),
        })),
    ];
    const v = arrivalVerdict(arriveAt, blocks);
    const iso = (d: Date) => d.toISOString();
    const arrival: RouteResponse['arrival'] =
      v.kind === 'FREE_FOR'
        ? { kind: 'FREE_FOR', minutes: v.minutes, until: iso(v.until) }
        : v.kind === 'CLASS_STARTS_SOON'
          ? { ...v, startsAt: iso(v.startsAt) }
          : v.kind === 'BUSY_UNTIL'
            ? { kind: 'BUSY_UNTIL', until: iso(v.until), ...(v.closed && { closed: true }) }
            : { kind: 'YOURS', until: iso(v.until) };

    metric('RoutesServed');
    const body: RouteResponse = {
      distanceMeters: Math.round(leg.distanceMeters),
      durationSeconds: Math.round(leg.durationSeconds),
      arriveAt: iso(arriveAt),
      geometry: { type: 'LineString', coordinates: leg.coordinates },
      steps: leg.steps,
      origin,
      destinationEntrance: {
        lat: destination.lat,
        lng: destination.lng,
        kind: accessible ? 'accessible' : 'main',
        label: destination.label,
      },
      accessibleRouting: ctx.router.accessibleRouting,
      arrival,
    };
    c.header('cache-control', 'no-store');
    return c.json(body);
  });

  return r;
}
