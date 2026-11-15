/**
 * Audit H1/H3: the 25Live sync must never leave a cached class without its slot locks (BR-1),
 * even if a run dies half-way, and must not wipe classes when 25Live returns a malformed payload.
 */
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ClassEvent } from '@freeroom/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/data/db';
import { syncSchedule } from '../src/sync/syncSchedule';
import { unwrapReservations } from '../src/twentyfive/mapper';
import { MockSource } from '../src/twentyfive/mock';
import type { ScheduleSource } from '../src/twentyfive/source';
import { setupTestApp, silent } from './helpers';

const NOW = new Date('2026-11-16T12:00:00Z');
const CLASS: ClassEvent = {
  eventId: 'evt-h1',
  roomId: 'ILC-0101',
  name: 'Resilience 101',
  start: new Date('2026-11-17T15:00:00.000Z'),
  end: new Date('2026-11-17T16:00:00.000Z'),
};

type T = Awaited<ReturnType<typeof setupTestApp>>;
let t: T;
let source: ScheduleSource;

beforeAll(async () => {
  t = await setupTestApp({ now: NOW, sync: false });
  const mock = new MockSource({ generateClasses: false, loadInjected: async () => [] });
  source = {
    name: mock.name,
    listBuildings: () => mock.listBuildings(),
    listRooms: () => mock.listRooms(),
    listEvents: async (roomIds) => (roomIds.includes(CLASS.roomId) ? [CLASS] : []),
  };
});

/** A Db whose first N slot-lock writes fail, like a Lambda dying mid-run. */
function crashingDb(db: Db, failures: number): Db {
  let left = failures;
  const send = (cmd: unknown) => {
    if (cmd instanceof UpdateCommand && cmd.input.Key?.SK === 'LOCK' && left-- > 0) {
      return Promise.reject(new Error('simulated crash'));
    }
    return db.doc.send(cmd as never);
  };
  return { ...db, doc: { send } as unknown as Db['doc'] };
}

describe('sync resilience (BR-1)', () => {
  it('a run that dies before locking is repaired by the next run', async () => {
    const opts = { roomIds: [CLASS.roomId] };
    await syncSchedule({ db: crashingDb(t.db, 1), source, now: NOW, log: silent }, opts);
    await syncSchedule({ db: t.db, source, now: NOW, log: silent }, opts);

    // Every slot of the class must be locked: a direct write over it is refused.
    const { getLocks } = await import('../src/data/schedule');
    const slots = [0, 15, 30, 45].map((m) => new Date(CLASS.start.getTime() + m * 60_000));
    const locks = await getLocks(
      t.db,
      slots.map((s) => ({ roomId: CLASS.roomId, slotIso: s.toISOString() })),
    );
    expect([...locks.values()].filter((l) => l.kind === 'class')).toHaveLength(4);
  });

  it('a malformed 25Live payload throws instead of meaning "no classes"', () => {
    expect(() => unwrapReservations({ unexpected: true })).toThrow();
    expect(() => unwrapReservations(null)).toThrow();
    expect(unwrapReservations({ reservations: {} })).toEqual([]); // genuinely empty is fine
  });
});

describe('sweeper resilience (BR-6)', () => {
  it('one failing release does not block the others', async () => {
    const { TransactWriteCommand } = await import('@aws-sdk/lib-dynamodb');
    const { sweep } = await import('../src/sweeper');
    const { getReservation } = await import('../src/data/reservations');
    // Full-scope sync (writes the room catalog) over a 1-day window to stay fast.
    await syncSchedule(
      { db: t.db, source, now: NOW, log: silent },
      { from: NOW, to: new Date('2026-11-17T00:00:00.000Z') },
    );
    const a = await t.reserve(
      'student2',
      'CS-0101',
      '2026-11-18T15:00:00.000Z',
      '2026-11-18T15:30:00.000Z',
    );
    const b = await t.reserve(
      'student2',
      'LGRT-0101',
      '2026-11-18T15:00:00.000Z',
      '2026-11-18T15:30:00.000Z',
    );
    expect([a.status, b.status]).toEqual([201, 201]);

    let failNext = true;
    const flaky: Db = {
      ...t.db,
      doc: {
        send: (cmd: unknown) => {
          if (cmd instanceof TransactWriteCommand && failNext) {
            failNext = false;
            return Promise.reject(new Error('poison item'));
          }
          return t.db.doc.send(cmd as never);
        },
      } as unknown as Db['doc'],
    };
    const out = await sweep(flaky, new Date('2026-11-18T11:30:00.000Z'));
    expect(out.released).toBe(1);
    expect(out.failed).toBe(1);
    const statuses = await Promise.all(
      [a.body.id, b.body.id].map(async (id: string) => (await getReservation(t.db, id))?.status),
    );
    expect(statuses.sort()).toEqual(['PENDING_CONFIRMATION', 'RELEASED']);
  });
});

describe('schedule source (audit H4)', () => {
  it('names the missing 25Live credential fields (never values)', async () => {
    const { missingCreds } = await import('../src/twentyfive/source');
    expect(missingCreds({})).toEqual(['baseUrl', 'username', 'password']);
    expect(missingCreds({ baseUrl: 'https://x', username: 'u' })).toEqual(['password']);
    expect(missingCreds({ baseUrl: 'https://x', username: 'u', password: 'p' })).toEqual([]);
  });
});

describe('cancel after transfer (audit M3)', () => {
  it('a stale owner cannot cancel a reservation that was transferred meanwhile', async () => {
    const { UpdateCommand: Upd } = await import('@aws-sdk/lib-dynamodb');
    const { cancelReservation, getReservation } = await import('../src/data/reservations');
    const { keys } = await import('../src/data/keys');
    const r = await t.reserve(
      'faculty1',
      'CS-0101',
      '2026-11-18T17:00:00.000Z',
      '2026-11-18T17:30:00.000Z',
    );
    expect(r.status).toBe(201);
    const stale = (await getReservation(t.db, r.body.id))!;
    // A claim TRANSFER lands between the read above and the write below.
    await t.db.doc.send(
      new Upd({
        TableName: t.db.table,
        Key: keys.reservation(stale.id),
        UpdateExpression: 'SET ownerId = :n',
        ExpressionAttributeValues: { ':n': 'tutor1' },
      }),
    );
    const ok = await cancelReservation(t.db, stale, stale.ownerId, NOW).catch(() => false);
    expect(ok).toBe(false);
    expect((await getReservation(t.db, stale.id))?.status).not.toBe('CANCELLED');
  });
});

describe('batch reads never drop keys silently (audit M7)', () => {
  it('throws when DynamoDB keeps returning unprocessed keys', async () => {
    const { batchGet } = await import('../src/data/db');
    const stuck = {
      ...t.db,
      doc: {
        send: async (cmd: { input: { RequestItems: Record<string, { Keys: unknown[] }> } }) => ({
          Responses: { [t.db.table]: [] },
          UnprocessedKeys: { [t.db.table]: { Keys: cmd.input.RequestItems[t.db.table]!.Keys } },
        }),
      },
    } as unknown as Db;
    await expect(batchGet(stuck, [{ PK: 'X', SK: 'Y' }])).rejects.toThrow(/unprocessed/i);
  }, 15_000);
});
