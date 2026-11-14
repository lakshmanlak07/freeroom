/**
 * Integration tests against DynamoDB Local (PRD §0.1 gate: BR-1, BR-6, BR-8, BR-9 on the server).
 * Clock pinned to Mon 2026-11-16 07:00 EST.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog, upsertCatalog } from '../src/data/catalog';
import { createReservation } from '../src/data/reservations';
import { getLocks, setSyncMeta } from '../src/data/schedule';
import { putUser } from '../src/data/users';
import { AppError } from '../src/errors';
import { MockSource } from '../src/twentyfive/mock';
import type { ScheduleSource } from '../src/twentyfive/source';
import { setupTestApp } from './helpers';

const NOW = new Date('2026-11-16T12:00:00Z');
type T = Awaited<ReturnType<typeof setupTestApp>>;
let t: T;

let n = 0;
async function newUser(role: 'STUDENT' | 'FACULTY' = 'STUDENT') {
  const userId = `u${++n}-${randomUUID().slice(0, 8)}`;
  await putUser(t.db, { userId, role, displayAlias: `User ${n}`, status: 'ACTIVE' });
  return userId;
}
const inject = (roomId: string, start: string, end: string, name: string) =>
  t.req('admin1', 'POST', '/demo/inject-class', { roomId, start, end, name });

beforeAll(async () => {
  t = await setupTestApp({ now: NOW });
});

describe('BR-8 double booking', () => {
  it('50 concurrent POSTs for one slot → exactly 1 success, 49 SLOT_TAKEN', async () => {
    const users = await Promise.all(Array.from({ length: 50 }, () => newUser()));
    const results = await Promise.all(
      users.map((u) => t.reserve(u, 'LGRT-0101', '2026-11-17T15:00:00Z', '2026-11-17T16:00:00Z')),
    );
    const wins = results.filter((r) => r.status === 201);
    expect(wins).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409 && r.body.error.code === 'SLOT_TAKEN'),
    ).toHaveLength(49);

    const slots = ['15:00', '15:15', '15:30', '15:45'].map((hm) => ({
      roomId: 'LGRT-0101',
      slotIso: `2026-11-17T${hm}:00.000Z`,
    }));
    const locks = await getLocks(t.db, slots);
    expect([...locks.values()].map((l) => l.resId)).toEqual(Array(4).fill(wins[0]!.body.id));
  });

  it('back-to-back reservations both succeed', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const r1 = await t.reserve(a, 'CS-0101', '2026-11-17T15:00:00Z', '2026-11-17T16:00:00Z');
    const r2 = await t.reserve(b, 'CS-0101', '2026-11-17T16:00:00Z', '2026-11-17T17:00:00Z');
    expect([r1.status, r2.status]).toEqual([201, 201]);
  });
});

describe('BR-1 class conflict', () => {
  it('rejects a reservation over a class with class details; touching edges allowed', async () => {
    const injected = await inject(
      'ILC-0101',
      '2026-11-17T14:05:00Z',
      '2026-11-17T14:55:00Z',
      'MATH 131-01: Calculus I',
    );
    expect(injected.status).toBe(201);
    const u = await newUser();
    const bad = await t.reserve(u, 'ILC-0101', '2026-11-17T14:00:00Z', '2026-11-17T15:00:00Z');
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('CLASS_CONFLICT');
    expect(bad.body.error.details.classes[0]).toMatchObject({
      name: 'Calculus I',
      courseCode: 'MATH 131',
      section: '01',
      start: '2026-11-17T14:05:00.000Z',
    });
    expect(
      (await t.reserve(u, 'ILC-0101', '2026-11-17T13:00:00Z', '2026-11-17T14:00:00Z')).status,
    ).toBe(201);
    expect(
      (await t.reserve(u, 'ILC-0101', '2026-11-17T15:00:00Z', '2026-11-17T16:00:00Z')).status,
    ).toBe(201);
  });

  it('class slot LOCKs block the write even if the pre-check is bypassed', async () => {
    const u = await newUser();
    const rec = {
      id: randomUUID(),
      roomId: 'ILC-0101',
      ownerId: u,
      start: '2026-11-17T14:30:00.000Z',
      end: '2026-11-17T14:45:00.000Z',
      partySize: 1,
      status: 'PENDING_CONFIRMATION' as const,
      releaseReason: null,
      createdAt: NOW.toISOString(),
      cutoffAt: '2026-11-17T10:30:00.000Z',
      confirmedAt: null,
      version: 1,
    };
    const err = await createReservation(t.db, {
      rec,
      maxActive: 2,
      idempotency: { userId: u, key: randomUUID(), requestHash: 'h', status: 201, body: {} },
      now: NOW,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('CLASS_CONFLICT');
  });
});

describe('idempotency', () => {
  it('retry with the same key returns the same reservation; different body → 400', async () => {
    const u = await newUser();
    const key = randomUUID();
    const a = await t.reserve(
      u,
      'HAS-0101',
      '2026-11-17T18:00:00Z',
      '2026-11-17T19:00:00Z',
      {},
      key,
    );
    const b = await t.reserve(
      u,
      'HAS-0101',
      '2026-11-17T18:00:00Z',
      '2026-11-17T19:00:00Z',
      {},
      key,
    );
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.id).toBe(a.body.id);
    const mine = await t.req(u, 'GET', '/me/reservations');
    expect(mine.body.reservations.map((r: { id: string }) => r.id)).toEqual([a.body.id]);
    const reused = await t.reserve(
      u,
      'HAS-0101',
      '2026-11-17T19:00:00Z',
      '2026-11-17T20:00:00Z',
      {},
      key,
    );
    expect(reused.status).toBe(400);
  });

  it('concurrent duplicates with one key create exactly one reservation', async () => {
    const u = await newUser();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      t.reserve(u, 'HAS-0111', '2026-11-17T18:00:00Z', '2026-11-17T19:00:00Z', {}, key),
      t.reserve(u, 'HAS-0111', '2026-11-17T18:00:00Z', '2026-11-17T19:00:00Z', {}, key),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
  });

  it('requires an Idempotency-Key', async () => {
    const r = await t.req('student1', 'POST', '/reservations', {
      roomId: 'HAS-0121',
      start: '2026-11-17T18:00:00Z',
      end: '2026-11-17T19:00:00Z',
      partySize: 1,
    });
    expect(r.status).toBe(400);
  });
});

describe('BR-9 class wins', () => {
  it('an injected class releases the reservation in one txn and attaches 3 alternatives', async () => {
    const u = await newUser();
    const res = await t.reserve(u, 'MORRILL-0101', '2026-11-18T15:00:00Z', '2026-11-18T16:00:00Z', {
      partySize: 2,
    });
    expect(res.status).toBe(201);

    t.clock.now = new Date(NOW.getTime() + 60_000); // the class lands a minute later
    try {
      expect(
        (
          await inject(
            'MORRILL-0101',
            '2026-11-18T15:30:00Z',
            '2026-11-18T16:30:00Z',
            'Surprise Exam',
          )
        ).status,
      ).toBe(201);
    } finally {
      t.clock.now = NOW;
    }

    const after = await t.req(u, 'GET', `/reservations/${res.body.id}`);
    expect(after.body).toMatchObject({ status: 'RELEASED', releaseReason: 'CLASS_CONFLICT' });

    const events = (await t.req(u, 'GET', `/reservations/${res.body.id}/events`)).body.events;
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'CREATED',
      'CONFLICTED',
      'RELEASED',
    ]);
    const released = events.find((e: { type: string }) => e.type === 'RELEASED');
    expect(released.reason).toBe('CLASS_CONFLICT');
    expect(released.details.class.name).toBe('Surprise Exam');
    const alts = released.details.alternatives;
    expect(alts).toHaveLength(3);
    expect(
      alts.every(
        (a: { buildingId: string; roomId: string }) =>
          a.buildingId === 'MORRILL' && a.roomId !== 'MORRILL-0101',
      ),
    ).toBe(true);

    const locks = await getLocks(
      t.db,
      ['15:00', '15:15', '15:30', '15:45', '16:00'].map((hm) => ({
        roomId: 'MORRILL-0101',
        slotIso: `2026-11-18T${hm}:00.000Z`,
      })),
    );
    expect(locks.has('MORRILL-0101|2026-11-18T15:00:00.000Z')).toBe(false);
    expect(locks.has('MORRILL-0101|2026-11-18T15:15:00.000Z')).toBe(false);
    for (const hm of ['15:30', '15:45', '16:00']) {
      expect(locks.get(`MORRILL-0101|2026-11-18T${hm}:00.000Z`)?.kind).toBe('class');
    }

    // Quota was freed: the student can hold 2 new reservations.
    expect(
      (await t.reserve(u, 'MORRILL-0111', '2026-11-18T15:00:00Z', '2026-11-18T16:00:00Z')).status,
    ).toBe(201);
    expect(
      (await t.reserve(u, 'MORRILL-0121', '2026-11-18T15:00:00Z', '2026-11-18T16:00:00Z')).status,
    ).toBe(201);
  });
});

describe('BR-6 confirmation + quotas + cancel', () => {
  it('confirm: TOO_EARLY before T−24h, OK inside window, CUTOFF_PASSED at cutoff', async () => {
    const u = await newUser('FACULTY');
    const a = await t.reserve(u, 'LGRT-0201', '2026-11-17T20:00:00Z', '2026-11-17T21:00:00Z');
    const b = await t.reserve(u, 'LGRT-0211', '2026-11-17T20:00:00Z', '2026-11-17T21:00:00Z');
    expect(a.body.status).toBe('PENDING_CONFIRMATION');
    expect((await t.req(u, 'POST', `/reservations/${a.body.id}/confirm`)).body.error.code).toBe(
      'TOO_EARLY',
    );
    try {
      t.clock.now = new Date('2026-11-17T15:59:59.999Z'); // cutoff − 1ms
      const ok = await t.req(u, 'POST', `/reservations/${a.body.id}/confirm`);
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('CONFIRMED');
      t.clock.now = new Date('2026-11-17T16:00:00.000Z'); // exactly cutoff
      const late = await t.req(u, 'POST', `/reservations/${b.body.id}/confirm`);
      expect([late.status, late.body.error.code]).toEqual([409, 'CUTOFF_PASSED']);
      expect((await t.req('student1', 'POST', `/reservations/${a.body.id}/confirm`)).status).toBe(
        403,
      );
    } finally {
      t.clock.now = NOW;
    }
  });

  it('created inside 24h is CONFIRMED immediately', async () => {
    const u = await newUser();
    const r = await t.reserve(u, 'TOBIN-0101', '2026-11-16T20:00:00Z', '2026-11-16T21:00:00Z');
    expect(r.body).toMatchObject({ status: 'CONFIRMED', isMine: true, claimable: false });
  });

  it('enforces the per-role active quota (student: 2) → 429', async () => {
    const u = await newUser();
    expect(
      (await t.reserve(u, 'GOESS-0101', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z')).status,
    ).toBe(201);
    expect(
      (await t.reserve(u, 'GOESS-0111', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z')).status,
    ).toBe(201);
    const third = await t.reserve(u, 'GOESS-0121', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z');
    expect([third.status, third.body.error.code]).toEqual([429, 'QUOTA_EXCEEDED']);
  });

  it('cancel releases the slot (owner only)', async () => {
    const [owner, other] = [await newUser(), await newUser()];
    const r = await t.reserve(owner, 'ISEN-0101', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z');
    expect((await t.req(other, 'DELETE', `/reservations/${r.body.id}`)).status).toBe(403);
    const del = await t.req(owner, 'DELETE', `/reservations/${r.body.id}`);
    expect([del.status, del.body.status]).toEqual([200, 'CANCELLED']);
    expect((await t.req(owner, 'DELETE', `/reservations/${r.body.id}`)).status).toBe(409);
    expect(
      (await t.reserve(other, 'ISEN-0101', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z')).status,
    ).toBe(201);
  });

  it('validates input with PRD error codes', async () => {
    const u = await newUser();
    const codes = await Promise.all([
      t.reserve(u, 'ISEN-0111', '2026-11-17T15:05:00Z', '2026-11-17T16:00:00Z'),
      t.reserve(u, 'ISEN-0111', '2026-11-16T11:00:00Z', '2026-11-16T11:30:00Z'),
      t.reserve(u, 'ISEN-0111', '2026-11-17T15:00:00Z', '2026-11-17T19:00:00Z'),
      t.reserve(u, 'ISEN-0111', '2026-11-25T15:00:00Z', '2026-11-25T16:00:00Z'),
      t.reserve(u, 'NOPE-1', '2026-11-17T15:00:00Z', '2026-11-17T16:00:00Z'),
    ]);
    expect(codes.map((c) => c.body.error.code)).toEqual([
      'INVALID_SLOT_BOUNDARY',
      'IN_PAST',
      'DURATION_EXCEEDED',
      'BEYOND_HORIZON',
      'NOT_FOUND',
    ]);
  });
});

describe('read APIs', () => {
  it('schedule returns classes and reservations with kind discriminator, aliases only', async () => {
    const r = await t.req(
      'student2',
      'GET',
      '/rooms/ILC-0101/schedule?from=2026-11-17T05:00:00Z&to=2026-11-18T05:00:00Z',
    );
    expect(r.status).toBe(200);
    const kinds = r.body.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain('class');
    expect(kinds).toContain('reservation');
    const res = r.body.items.find((i: { kind: string }) => i.kind === 'reservation');
    expect(res).toMatchObject({ isMine: false, ownerAlias: expect.any(String) });
    expect(res).not.toHaveProperty('ownerId');
    expect(r.body.staleness.lastSyncedAt).toBe(NOW.toISOString());
  });

  it('rooms search filters and reports status; buildings report freePct', async () => {
    const all = await t.req('student1', 'GET', '/rooms');
    expect(all.body.rooms).toHaveLength(80);
    const big = await t.req('student1', 'GET', '/rooms?minCapacity=100&building=LGRT');
    expect(
      big.body.rooms.every(
        (x: { capacity: number; buildingId: string }) =>
          x.capacity >= 100 && x.buildingId === 'LGRT',
      ),
    ).toBe(true);
    const window = await t.req(
      'student1',
      'GET',
      '/rooms?freeFrom=2026-11-17T15:00:00Z&freeTo=2026-11-17T16:00:00Z',
    );
    expect(window.body.rooms.map((x: { roomId: string }) => x.roomId)).not.toContain('LGRT-0101');
    const b = await t.req('student1', 'GET', '/buildings');
    expect(b.body.buildings).toHaveLength(10);
    expect(b.body.buildings[0]).toMatchObject({ freePct: expect.any(Number), roomCount: 8 });
  });
});

describe('fail closed when 25Live is unreachable (PRD §8.1)', () => {
  it('503 when data is missing/older than 6h; cached data used when < 6h', async () => {
    const mock = new MockSource({ generateClasses: false });
    const down: ScheduleSource = {
      name: 'down',
      listBuildings: () => mock.listBuildings(),
      listRooms: () => mock.listRooms(),
      listEvents: async () => {
        throw new Error('25Live unreachable');
      },
    };
    const d = await setupTestApp({
      now: NOW,
      source: down,
      sync: false,
      deps: { refreshTimeoutMs: 500 },
    });
    await upsertCatalog(d.db, await mock.listBuildings(), await mock.listRooms());
    await getCatalog(d.db, NOW.getTime());

    const r = await d.reserve(
      'student1',
      'LGRT-0101',
      '2026-11-17T15:00:00Z',
      '2026-11-17T16:00:00Z',
    );
    expect([r.status, r.body.error.code]).toEqual([503, 'SCHEDULE_UNAVAILABLE']);

    await setSyncMeta(
      d.db,
      'LGRT-0101',
      '2026-11-17',
      new Date(NOW.getTime() - 3_600_000).toISOString(),
    );
    expect(
      (await d.reserve('student1', 'LGRT-0101', '2026-11-17T15:00:00Z', '2026-11-17T16:00:00Z'))
        .status,
    ).toBe(201);
  });
});
