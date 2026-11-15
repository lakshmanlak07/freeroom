/** "Get me there" route handler with a mocked Amazon Location Routes client. */
import { beforeAll, describe, expect, it } from 'vitest';
import { RouteCache, type Router, type WalkLeg } from '../src/directions/router';
import { createLogger } from '../src/logger';
import { ENTRANCES } from '../src/twentyfive/campus';
import { setupTestApp } from './helpers';

const NOW = new Date('2026-11-16T15:00:00Z'); // Mon 10:00 campus time
const LEG: WalkLeg = {
  distanceMeters: 480,
  durationSeconds: 360,
  coordinates: [
    [-72.5265, 42.3912],
    [-72.5268, 42.3925],
    [-72.52685, 42.39385],
  ],
  steps: [
    {
      instruction: 'Head north on the path',
      distanceMeters: 300,
      durationSeconds: 220,
      type: 'Depart',
    },
    {
      instruction: 'Turn left',
      distanceMeters: 180,
      durationSeconds: 140,
      type: 'Turn',
      direction: 'left',
    },
  ],
};

const calls: { origin: { lat: number; lng: number } }[] = [];
let fail = false;
const router: Router = {
  accessibleRouting: false,
  async walk(origin) {
    calls.push({ origin });
    if (fail) throw new Error('ThrottlingException');
    return LEG;
  },
};
const lines: string[] = [];

type T = Awaited<ReturnType<typeof setupTestApp>>;
let t: T;
beforeAll(async () => {
  t = await setupTestApp({
    now: NOW,
    deps: {
      features: { directions: true },
      router,
      routeCache: new RouteCache(),
      logger: createLogger({}, (l) => lines.push(l)),
    },
  });
});

const url = (q: string) => `/rooms/LGRT-0101/route?${q}`;

describe('GET /rooms/:id/route', () => {
  it('returns ETA, geometry, steps, the entrance and an arrival verdict; origin rounded to ~10 m', async () => {
    const r = await t.req('student1', 'GET', url('from=42.39123456,-72.52654321'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      distanceMeters: 480,
      durationSeconds: 360,
      arriveAt: '2026-11-16T15:06:00.000Z',
      origin: { lat: 42.3912, lng: -72.5265 },
      destinationEntrance: { kind: 'main', ...ENTRANCES.LGRT!.main },
      accessibleRouting: false,
      geometry: { type: 'LineString' },
    });
    expect(r.body.steps).toHaveLength(2);
    expect(['FREE_FOR', 'CLASS_STARTS_SOON', 'BUSY_UNTIL', 'YOURS']).toContain(r.body.arrival.kind);
    expect(calls.at(-1)!.origin).toEqual({ lat: 42.3912, lng: -72.5265 }); // provider never sees raw
  });

  it('accessible=true targets the accessible entrance and says honestly it is not step-free routing', async () => {
    const r = await t.req('student1', 'GET', url('from=42.3912,-72.5265&accessible=true'));
    expect(r.status).toBe(200);
    expect(r.body.destinationEntrance).toMatchObject({
      kind: 'accessible',
      ...ENTRANCES.LGRT!.accessible,
    });
    expect(r.body.accessibleRouting).toBe(false);
  });

  it('"I\'m at…" a building routes from that building\'s main entrance', async () => {
    const r = await t.req('student1', 'GET', url('from=building:DUBOIS'));
    expect(r.status).toBe(200);
    const door = ENTRANCES.DUBOIS!.main;
    expect(r.body.origin).toEqual({ lat: door.lat, lng: door.lng });
  });

  it('rejects malformed origins and unknown rooms', async () => {
    expect((await t.req('student1', 'GET', url('from=somewhere'))).status).toBe(400);
    expect((await t.req('student1', 'GET', '/rooms/NOPE-1/route?from=building:LGRT')).status).toBe(
      404,
    );
  });

  it('requires sign-in', async () => {
    const res = await t.app.request(url('from=building:LGRT'));
    expect(res.status).toBe(401);
  });

  it('provider failure → 503 ROUTING_UNAVAILABLE, and coordinates never reach the logs', async () => {
    fail = true;
    const r = await t.req('faculty1', 'GET', url('from=42.38001234,-72.51998765'));
    fail = false;
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('ROUTING_UNAVAILABLE');
    const all = lines.join('\n');
    expect(all).toContain('route.failed'); // we did log the failure…
    for (const needle of [
      '42.38001234',
      '-72.51998765',
      '42.38',
      '-72.52',
      '42.3912',
      '-72.5265',
    ]) {
      expect(all).not.toContain(needle); // …but never where the user is
    }
  });

  it('rate limits at 20 requests per minute per user', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) {
      codes.push((await t.req('tutor1', 'GET', url('from=building:ILC'))).status);
    }
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it('caches by (rounded origin, room, accessible) for 2 minutes', async () => {
    const before = calls.length;
    await t.req('admin1', 'GET', url('from=42.39001,-72.52001'));
    await t.req('admin1', 'GET', url('from=42.39004,-72.52004')); // same ~10 m cell
    expect(calls.length - before).toBe(1);
  });

  it('is off (404) when the feature flag is off', async () => {
    const off = await setupTestApp({ now: NOW, deps: { router } });
    expect((await off.req('student1', 'GET', url('from=building:LGRT'))).status).toBe(404);
  });
});
