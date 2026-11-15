/**
 * Reservation writes. BR-8: double booking is impossible because every write is ONE
 * TransactWriteItems with a slot LOCK per 15-min slot (attribute_not_exists) — never read-then-write.
 * BR-6: confirm carries `cutoffAt > :now` (server clock) inside the condition.
 */
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  campusDay,
  campusDaysOf,
  coveringSlots,
  enumerateSlots,
  findClassConflicts,
  type ClassEvent,
} from '@freeroom/domain';
import type { ReleaseReason, ReservationEventType, ReservationStatus } from '@freeroom/shared';
import { randomUUID } from 'node:crypto';
import { currentCorrelationId } from '../correlation';
import { AppError } from '../errors';
import { batchGet, queryAll, ttlFrom, type Db, type Item } from './db';
import { keys } from './keys';
import { getRoomDay } from './schedule';

export interface ReservationRecord {
  id: string;
  roomId: string;
  ownerId: string;
  start: string;
  end: string;
  partySize: number;
  purpose?: string;
  status: ReservationStatus;
  releaseReason: ReleaseReason | null;
  createdAt: string;
  cutoffAt: string;
  confirmedAt: string | null;
  version: number;
}

export interface ResEvent {
  eventId: string;
  type: ReservationEventType;
  at: string;
  actorId: string | null;
  reason?: string;
  data?: Record<string, unknown>;
  /** Internal: user ids the notifier should inform. Never returned by the API. */
  notify?: string[];
}

export type TxItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

export const asInterval = (r: Pick<ReservationRecord, 'start' | 'end'>) => ({
  start: new Date(r.start),
  end: new Date(r.end),
});

export const toRecord = (i: Item): ReservationRecord => ({
  id: i.id as string,
  roomId: i.roomId as string,
  ownerId: i.ownerId as string,
  start: i.start as string,
  end: i.end as string,
  partySize: i.partySize as number,
  ...(i.purpose ? { purpose: i.purpose as string } : {}),
  status: i.status as ReservationStatus,
  releaseReason: (i.releaseReason as ReleaseReason | undefined) ?? null,
  createdAt: i.createdAt as string,
  cutoffAt: i.cutoffAt as string,
  confirmedAt: (i.confirmedAt as string | undefined) ?? null,
  version: i.version as number,
});

export const eventPut = (
  db: Db,
  resId: string,
  seq: number,
  e: Omit<ResEvent, 'eventId'>,
  now: Date,
): TxItem => {
  const eventId = randomUUID();
  return {
    Put: {
      TableName: db.table,
      Item: {
        ...keys.resEvent(resId, e.at, seq, eventId),
        eventId,
        reservationId: resId,
        ...e,
        ...(currentCorrelationId() && { correlationId: currentCorrelationId() }),
        ttl: ttlFrom(now, 365),
      },
      ConditionExpression: 'attribute_not_exists(PK)', // audit is append-only
    },
  };
};

export const quotaRemove = (db: Db, ownerId: string, resId: string): TxItem => ({
  Update: {
    TableName: db.table,
    Key: keys.quota(ownerId),
    UpdateExpression: 'REMOVE active.#id ADD version :one',
    ExpressionAttributeNames: { '#id': resId },
    ExpressionAttributeValues: { ':one': 1 },
  },
});

export const reasonCodes = (e: unknown): (string | undefined)[] =>
  e instanceof TransactionCanceledException ? (e.CancellationReasons ?? []).map((r) => r.Code) : [];

export const jitter = (attempt: number) =>
  new Promise((r) => setTimeout(r, Math.random() * 25 * (attempt + 1)));

export async function getReservation(db: Db, id: string): Promise<ReservationRecord | null> {
  const r = await db.doc.send(
    new GetCommand({ TableName: db.table, Key: keys.reservation(id), ConsistentRead: true }),
  );
  return r.Item ? toRecord(r.Item) : null;
}

/** Reservations starting on the given campus days (callers add the previous day for overlaps). */
export async function listRoomReservations(db: Db, roomId: string, days: readonly string[]) {
  const rows = await Promise.all(
    days.map((day) =>
      queryAll(db, {
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :p AND begins_with(GSI1SK, :r)',
        ExpressionAttributeValues: { ':p': keys.gsi1.resPk(roomId, day), ':r': keys.prefix.res },
      }),
    ),
  );
  return rows.flat().map(toRecord);
}

export async function listUserReservations(
  db: Db,
  userId: string,
  scope: 'upcoming' | 'past',
  now: Date,
) {
  // Reservations are ≤ 4h, so "start ≥ now − 4h" bounds every reservation not yet ended.
  const pivot = keys.gsi2.resSk(new Date(now.getTime() - 4 * 3_600_000).toISOString());
  const items = await queryAll(db, {
    IndexName: 'GSI2',
    KeyConditionExpression:
      scope === 'upcoming'
        ? 'GSI2PK = :p AND GSI2SK >= :s'
        : 'GSI2PK = :p AND GSI2SK BETWEEN :r AND :s',
    ExpressionAttributeValues: {
      ':p': keys.gsi2.userPk(userId),
      ':s': scope === 'upcoming' ? pivot : keys.gsi2.resSk(now.toISOString()),
      ...(scope === 'past' && { ':r': keys.prefix.res }),
    },
    ScanIndexForward: scope === 'upcoming',
  });
  const nowIso = now.toISOString();
  return items
    .map(toRecord)
    .filter((r) => (scope === 'upcoming' ? r.end > nowIso : r.end <= nowIso))
    .slice(0, 100);
}

export async function listReservationEvents(db: Db, id: string): Promise<ResEvent[]> {
  const items = await queryAll(db, {
    KeyConditionExpression: 'PK = :p AND begins_with(SK, :e)',
    ExpressionAttributeValues: { ':p': keys.resPk(id), ':e': keys.prefix.evt },
  });
  return items.map((i) => ({
    eventId: i.eventId as string,
    type: i.type as ReservationEventType,
    at: i.at as string,
    actorId: (i.actorId as string | null) ?? null,
    ...(i.reason ? { reason: i.reason as string } : {}),
    ...(i.data ? { data: i.data as Record<string, unknown> } : {}),
  }));
}

export interface CreateInput {
  rec: ReservationRecord;
  maxActive: number;
  idempotency: { userId: string; key: string; requestHash: string; status: number; body: unknown };
  now: Date;
}

export type CreateOutcome = { kind: 'created' } | { kind: 'replay'; status: number; body: unknown };

export async function getIdempotent(db: Db, userId: string, key: string) {
  const r = await db.doc.send(
    new GetCommand({
      TableName: db.table,
      Key: keys.idempotency(userId, key),
      ConsistentRead: true,
    }),
  );
  return r.Item as { requestHash: string; status: number; body: unknown } | undefined;
}

/**
 * ONE TransactWriteItems: META + quota (optimistic version) + CREATED event + idempotency
 * record + one LOCK per 15-min slot. Item order matters: cancellation reasons map by index.
 */
export async function createReservation(db: Db, input: CreateInput): Promise<CreateOutcome> {
  const { rec, now, idempotency: idem } = input;
  const nowIso = now.toISOString();
  const slots = enumerateSlots(asInterval(rec));
  const day = keys.gsi1.resPk(rec.roomId, campusDay(new Date(rec.start)));
  const LOCK0 = 4;

  for (let attempt = 0; attempt < 10; attempt++) {
    const q = await db.doc.send(
      new GetCommand({ TableName: db.table, Key: keys.quota(rec.ownerId), ConsistentRead: true }),
    );
    const version = (q.Item?.version as number | undefined) ?? 0;
    const active = Object.fromEntries(
      Object.entries((q.Item?.active as Record<string, string> | undefined) ?? {}).filter(
        ([, end]) => end > nowIso,
      ),
    );
    if (Object.keys(active).length >= input.maxActive) {
      throw new AppError('QUOTA_EXCEEDED', 'Active reservation limit reached', {
        maxActive: input.maxActive,
      });
    }

    const items: TxItem[] = [
      {
        Put: {
          TableName: db.table,
          Item: {
            ...keys.reservation(rec.id),
            ...rec,
            GSI1PK: day,
            GSI1SK: keys.gsi1.resSk(rec.start, rec.id),
            GSI2PK: keys.gsi2.userPk(rec.ownerId),
            GSI2SK: keys.gsi2.resSk(rec.start),
            ...(rec.status === 'PENDING_CONFIRMATION' && {
              GSI4PK: keys.gsi4.sweepRes,
              GSI4SK: keys.gsi4.sk(rec.cutoffAt, rec.id),
            }),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: db.table,
          Item: {
            ...keys.quota(rec.ownerId),
            active: { ...active, [rec.id]: rec.end },
            version: version + 1,
          },
          ConditionExpression: q.Item ? 'version = :v' : 'attribute_not_exists(PK)',
          ...(q.Item && { ExpressionAttributeValues: { ':v': version } }),
        },
      },
      eventPut(db, rec.id, 0, { type: 'CREATED', at: nowIso, actorId: rec.ownerId }, now),
      {
        Put: {
          TableName: db.table,
          Item: {
            ...keys.idempotency(idem.userId, idem.key),
            requestHash: idem.requestHash,
            status: idem.status,
            body: idem.body,
            ttl: ttlFrom(now, 1),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      ...slots.map((s): TxItem => ({
        Put: {
          TableName: db.table,
          Item: {
            ...keys.lock(rec.roomId, s.toISOString()),
            kind: 'reservation',
            resId: rec.id,
            roomId: rec.roomId,
            slot: s.toISOString(),
            ttl: ttlFrom(new Date(rec.end), 7),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      })),
    ];

    try {
      await db.doc.send(new TransactWriteCommand({ TransactItems: items }));
      return { kind: 'created' };
    } catch (e) {
      const codes = reasonCodes(e);
      if (!codes.length) throw e;
      if (codes[3] === 'ConditionalCheckFailed') {
        const prior = await getIdempotent(db, idem.userId, idem.key);
        if (prior?.requestHash !== idem.requestHash) {
          throw new AppError('VALIDATION_ERROR', 'Idempotency-Key reused with a different request');
        }
        return { kind: 'replay', status: prior.status, body: prior.body };
      }
      const failedSlots = slots.filter((_, i) => codes[LOCK0 + i] === 'ConditionalCheckFailed');
      if (failedSlots.length) {
        const locks = await batchGet(
          db,
          failedSlots.map((s) => keys.lock(rec.roomId, s.toISOString())),
        );
        if (locks.some((l) => l.kind === 'class')) throw await classConflict(db, rec);
        throw new AppError('SLOT_TAKEN', 'That time is already reserved');
      }
      if (codes[1] === 'ConditionalCheckFailed' || codes.includes('TransactionConflict')) {
        await jitter(attempt); // quota version race or concurrent txn: re-read and retry
        continue;
      }
      throw e;
    }
  }
  throw new AppError('SLOT_TAKEN', 'That time is contended; try again');
}

async function classConflict(db: Db, rec: ReservationRecord) {
  const iv = asInterval(rec);
  const days = campusDaysOf(iv);
  const classes = (await Promise.all(days.map((d) => getRoomDay(db, rec.roomId, d)))).flatMap(
    (d) => d.classes,
  );
  return new AppError('CLASS_CONFLICT', 'A class is scheduled in this room', {
    classes: findClassConflicts({ ...iv, roomId: rec.roomId }, classes).map(classDetails),
  });
}

export const classDetails = (c: ClassEvent) => ({
  eventId: c.eventId,
  name: c.name,
  courseCode: c.courseCode,
  section: c.section,
  eventType: c.eventType,
  organization: c.organization,
  start: c.start.toISOString(),
  end: c.end.toISOString(),
});

/** Confirm: `cutoffAt > :now` evaluated by DynamoDB at write time (BR-6). False = condition failed. */
export async function confirmReservation(
  db: Db,
  rec: ReservationRecord,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString();
  try {
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: db.table,
              Key: keys.reservation(rec.id),
              UpdateExpression:
                'SET #s = :c, confirmedAt = :now, version = version + :one REMOVE GSI4PK, GSI4SK',
              ConditionExpression: '#s = :p AND cutoffAt > :now AND ownerId = :owner',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':c': 'CONFIRMED',
                ':p': 'PENDING_CONFIRMATION',
                ':now': nowIso,
                ':one': 1,
                ':owner': rec.ownerId,
              },
            },
          },
          eventPut(db, rec.id, 0, { type: 'CONFIRMED', at: nowIso, actorId: rec.ownerId }, now),
        ],
      }),
    );
    return true;
  } catch (e) {
    if (reasonCodes(e)[0] === 'ConditionalCheckFailed') return false;
    throw e;
  }
}

/** Cancel: status → CANCELLED, delete this reservation's locks, free quota, audit. */
export async function cancelReservation(
  db: Db,
  rec: ReservationRecord,
  actorId: string,
  now: Date,
) {
  const nowIso = now.toISOString();
  const slots = enumerateSlots(asInterval(rec));
  try {
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: db.table,
              Key: keys.reservation(rec.id),
              UpdateExpression: 'SET #s = :x, version = version + :one REMOVE GSI4PK, GSI4SK',
              ConditionExpression: '#s IN (:p, :c) AND ownerId = :owner', // audit M3: pin the owner we read
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':x': 'CANCELLED',
                ':owner': rec.ownerId,
                ':p': 'PENDING_CONFIRMATION',
                ':c': 'CONFIRMED',
                ':one': 1,
              },
            },
          },
          quotaRemove(db, rec.ownerId, rec.id),
          eventPut(db, rec.id, 0, { type: 'CANCELLED', at: nowIso, actorId }, now),
          ...slots.map((s): TxItem => ({
            Delete: {
              TableName: db.table,
              Key: keys.lock(rec.roomId, s.toISOString()),
              ConditionExpression: 'resId = :id',
              ExpressionAttributeValues: { ':id': rec.id },
            },
          })),
        ],
      }),
    );
    return true;
  } catch (e) {
    if (reasonCodes(e).includes('ConditionalCheckFailed')) return false;
    throw e;
  }
}

/**
 * BR-9 in ONE transaction: reservation → RELEASED (CLASS_CONFLICT); its slots overlapping the
 * class become class locks, the rest are deleted; quota freed; CONFLICTED + RELEASED events
 * (RELEASED carries class details + alternatives). False = reservation no longer active.
 */
export async function releaseForClassConflict(
  db: Db,
  rec: ReservationRecord,
  cls: ClassEvent,
  alternatives: Record<string, unknown>[],
  now: Date,
) {
  const nowIso = now.toISOString();
  const classSlots = new Set(coveringSlots(cls).map((s) => s.toISOString()));
  const details = classDetails(cls);
  const items: TxItem[] = [
    {
      Update: {
        TableName: db.table,
        Key: keys.reservation(rec.id),
        UpdateExpression:
          'SET #s = :r, releaseReason = :why, version = version + :one REMOVE GSI4PK, GSI4SK',
        ConditionExpression: '#s IN (:p, :c) AND ownerId = :owner', // audit M3: pin the owner we read
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':r': 'RELEASED',
          ':why': 'CLASS_CONFLICT',
          ':owner': rec.ownerId,
          ':p': 'PENDING_CONFIRMATION',
          ':c': 'CONFIRMED',
          ':one': 1,
        },
      },
    },
    quotaRemove(db, rec.ownerId, rec.id),
    eventPut(
      db,
      rec.id,
      0,
      { type: 'CONFLICTED', at: nowIso, actorId: null, data: { class: details } },
      now,
    ),
    eventPut(
      db,
      rec.id,
      1,
      {
        type: 'RELEASED',
        at: nowIso,
        actorId: null,
        reason: 'CLASS_CONFLICT',
        data: { class: details, alternatives },
        notify: [rec.ownerId],
      },
      now,
    ),
    ...enumerateSlots(asInterval(rec)).map((s): TxItem => {
      const slotIso = s.toISOString();
      const Key = keys.lock(rec.roomId, slotIso);
      const cond = {
        ConditionExpression: 'resId = :id',
        ExpressionAttributeValues: { ':id': rec.id },
      };
      return classSlots.has(slotIso)
        ? {
            Put: {
              TableName: db.table,
              Item: {
                ...Key,
                kind: 'class',
                roomId: rec.roomId,
                slot: slotIso,
                eventIds: new Set([cls.eventId]),
                ttl: ttlFrom(s, 7),
              },
              ...cond,
            },
          }
        : { Delete: { TableName: db.table, Key, ...cond } };
    }),
  ];
  try {
    await db.doc.send(new TransactWriteCommand({ TransactItems: items }));
    return true;
  } catch (e) {
    if (reasonCodes(e).includes('ConditionalCheckFailed')) return false;
    throw e;
  }
}

/** Sweeper (BR-6): unconfirmed at cutoff → RELEASED (UNCONFIRMED). Idempotent via condition. */
export async function releaseUnconfirmed(db: Db, rec: ReservationRecord, now: Date) {
  const nowIso = now.toISOString();
  try {
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: db.table,
              Key: keys.reservation(rec.id),
              UpdateExpression:
                'SET #s = :r, releaseReason = :why, version = version + :one REMOVE GSI4PK, GSI4SK',
              ConditionExpression: '#s = :p AND cutoffAt <= :now AND ownerId = :owner',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':r': 'RELEASED',
                ':why': 'UNCONFIRMED',
                ':owner': rec.ownerId,
                ':p': 'PENDING_CONFIRMATION',
                ':now': nowIso,
                ':one': 1,
              },
            },
          },
          quotaRemove(db, rec.ownerId, rec.id),
          eventPut(
            db,
            rec.id,
            0,
            {
              type: 'RELEASED',
              at: nowIso,
              actorId: null,
              reason: 'UNCONFIRMED',
              notify: [rec.ownerId],
            },
            now,
          ),
          ...enumerateSlots(asInterval(rec)).map((s): TxItem => ({
            Delete: {
              TableName: db.table,
              Key: keys.lock(rec.roomId, s.toISOString()),
              ConditionExpression: 'resId = :id',
              ExpressionAttributeValues: { ':id': rec.id },
            },
          })),
        ],
      }),
    );
    return true;
  } catch (e) {
    if (reasonCodes(e).includes('ConditionalCheckFailed')) return false;
    throw e;
  }
}

/** Reservations still PENDING_CONFIRMATION whose cutoff is at or before now (sparse GSI4). */
export async function listDueUnconfirmed(db: Db, now: Date) {
  const items = await queryAll(db, {
    IndexName: 'GSI4',
    KeyConditionExpression: 'GSI4PK = :p AND GSI4SK <= :u',
    ExpressionAttributeValues: {
      ':p': keys.gsi4.sweepRes,
      ':u': keys.gsi4.dueBy(now.toISOString()),
    },
  });
  return items.map(toRecord);
}
