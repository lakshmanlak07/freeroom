/**
 * Demo-mode seed so the pitch opens rich: a mix of free/busy buildings right now, a claimable
 * reservation owned by student2, a pending one of student1's near its cutoff, and an incoming
 * claim for student1. Everything goes through the real write paths (slot LOCK transactions, so
 * BR-1/BR-8 still hold); a candidate that hits a class or another lock is simply skipped.
 * Callers: /demo/reset, `pnpm dev:api`, infra postDeploy. Never runs outside demo mode.
 */
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { addHours, cutoffAt } from '@freeroom/domain';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from './data/catalog';
import { newClaimId, submitClaim } from './data/claims';
import type { Db } from './data/db';
import { keys } from './data/keys';
import { createReservation, type ReservationRecord } from './data/reservations';
import { AppError } from './errors';

/** Demo alias → stored userId (identity locally; Cognito subs when deployed). */
export type DemoIds = Record<'student1' | 'student2' | 'faculty1' | 'tutor1' | 'admin1', string>;
export const LOCAL_DEMO_IDS: DemoIds = {
  student1: 'student1',
  student2: 'student2',
  faculty1: 'faculty1',
  tutor1: 'tutor1',
  admin1: 'admin1',
};

export async function putDemoIds(db: Db, ids: DemoIds) {
  await db.doc.send(new PutCommand({ TableName: db.table, Item: { ...keys.demoIds, ids } }));
}
async function readDemoIds(db: Db) {
  const r = await db.doc.send(new GetCommand({ TableName: db.table, Key: keys.demoIds }));
  return r.Item?.ids as DemoIds | undefined;
}
export const getDemoIds = async (db: Db) => (await readDemoIds(db)) ?? LOCAL_DEMO_IDS;

/** First run only (no ids stored yet): store the map and seed. Later re-seeds = Demo → Reset. */
export async function seedDemoOnce(db: Db, ids: DemoIds, now: Date) {
  if (await readDemoIds(db)) return null;
  await putDemoIds(db, ids);
  return seedDemo(db, ids, now);
}

const SLOT_MS = 15 * 60_000;
const floorSlot = (d: Date) => new Date(Math.floor(d.getTime() / SLOT_MS) * SLOT_MS);
/** Rooms busy per building, cycled: 0/8 green, 3/8 green, 5/8 amber, 7/8 red. */
const BUSY_PATTERN = [0, 3, 5, 7];

export async function seedDemo(db: Db, ids: DemoIds, now: Date) {
  const { buildings, rooms } = await loadCatalog(db);
  const quota: Record<string, number> = {
    [ids.faculty1]: 5,
    [ids.tutor1]: 3,
    [ids.admin1]: Infinity,
    [ids.student1]: 2,
    [ids.student2]: 2,
  };
  let made = 0;

  const tryCreate = async (
    roomId: string,
    ownerId: string,
    start: Date,
    hours: number,
    status: ReservationRecord['status'],
    purpose: string,
  ) => {
    const rec: ReservationRecord = {
      id: randomUUID(),
      roomId,
      ownerId,
      start: start.toISOString(),
      end: addHours(start, hours).toISOString(),
      partySize: 4,
      purpose,
      status,
      releaseReason: null,
      createdAt: addHours(now, -26).toISOString(), // as if booked two days out
      cutoffAt: cutoffAt(start).toISOString(),
      confirmedAt: status === 'CONFIRMED' ? now.toISOString() : null,
      version: 1,
    };
    try {
      await createReservation(db, {
        rec,
        maxActive: quota[ownerId] ?? 2,
        idempotency: {
          userId: ownerId,
          key: `demo-seed-${rec.id}`,
          requestHash: 'seed',
          status: 201,
          body: null,
        },
        now,
      });
      made++;
      return rec;
    } catch (e) {
      if (e instanceof AppError) return null; // class there, slot taken, or quota: skip
      throw e;
    }
  };

  // 1. Busy right now (2.5h from the current slot), spread so the map shows every tier.
  const nowStart = floorSlot(now);
  const owners = [ids.faculty1, ids.faculty1, ids.faculty1, ids.tutor1, ids.tutor1];
  let o = 0;
  for (const [i, b] of buildings.entries()) {
    const want = BUSY_PATTERN[i % BUSY_PATTERN.length]!;
    let got = 0;
    for (const r of rooms.filter((x) => x.buildingId === b.buildingId)) {
      if (got >= want) break;
      const owner = owners[o] ?? ids.admin1;
      if (await tryCreate(r.roomId, owner, nowStart, 2.5, 'CONFIRMED', 'Study group')) {
        got++;
        o++;
      }
    }
  }

  // Later ones stay ≥ 4h15m out so they are still confirmable/claimable (BR-6).
  const firstFree = async (
    owner: string,
    inHours: number,
    hours: number,
    status: ReservationRecord['status'],
    purpose: string,
  ) => {
    const start = floorSlot(addHours(now, inHours));
    for (const r of rooms) {
      const rec = await tryCreate(r.roomId, owner, start, hours, status, purpose);
      if (rec) return rec;
    }
    return null;
  };

  // 2. Claimable reservation owned by student2.
  const claimable = await firstFree(ids.student2, 20, 1.5, 'CONFIRMED', 'Chem 111 study session');
  // 3. student1's pending reservation: cutoff ~30 min away, confirm window open.
  const pending = await firstFree(ids.student1, 4.75, 1, 'PENDING_CONFIRMATION', 'Thesis writing');
  // 4. student1's reservation with an incoming claim from student2.
  const wanted = await firstFree(ids.student1, 22, 1.5, 'CONFIRMED', 'COMPSCI 220 review');
  if (wanted) {
    await submitClaim(
      db,
      {
        claimId: newClaimId(wanted.id),
        reservationId: wanted.id,
        requesterId: ids.student2,
        ownerId: wanted.ownerId,
        message: 'Group of 4 for the COMPSCI 220 midterm. Could we swap rooms?',
        partySize: 4,
        status: 'PENDING',
        mode: null,
        createdAt: now.toISOString(),
        expiresAt: wanted.cutoffAt,
        decidedAt: null,
      },
      wanted,
      now,
    );
  }
  return {
    reservations: made,
    claimable: claimable?.id ?? null,
    pending: pending?.id ?? null,
    claimed: wanted?.id ?? null,
  };
}
