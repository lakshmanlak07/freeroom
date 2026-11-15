/**
 * Group invites (feature flag `features.invites`).
 * - Token: 128 random bits, base64url. Only SHA-256(token) is stored (INVITE#{hash}), with a TTL at
 *   the reservation's end. One active link per reservation (RES#{id}/INVITELINK); creating a new
 *   one revokes the old in the same transaction.
 * - Attendees: RES#{id}/ATTENDEE#{userId} (alias copied at join time) + an `attendeeCount` counter
 *   on the reservation META, guarded by a condition so attendees + owner never exceed capacity.
 *   Attendees are not owners (BR-4): they can't confirm, cancel or transfer.
 */
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors';
import { queryAll, type Db } from './db';
import { keys } from './keys';
import {
  eventPut,
  getReservation,
  reasonCodes,
  type ReservationRecord,
  type TxItem,
} from './reservations';

export const newInviteToken = () => randomBytes(16).toString('base64url');
export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const ACTIVE = ['PENDING_CONFIRMATION', 'CONFIRMED'];

export async function getInviteLink(db: Db, resId: string) {
  const r = await db.doc.send(
    new GetCommand({ TableName: db.table, Key: keys.inviteLink(resId), ConsistentRead: true }),
  );
  return (r.Item?.tokenHash as string | undefined) ?? null;
}

/** New link for a reservation; the previous one (if any) stops working atomically. */
export async function createInvite(db: Db, rec: ReservationRecord, now: Date) {
  const token = newInviteToken();
  const tokenHash = hashInviteToken(token);
  const old = await getInviteLink(db, rec.id);
  const ttl = epoch(rec.end);
  const items: TxItem[] = [
    {
      Put: {
        TableName: db.table,
        Item: { ...keys.invite(tokenHash), resId: rec.id, createdAt: now.toISOString(), ttl },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    {
      Put: {
        TableName: db.table,
        Item: { ...keys.inviteLink(rec.id), tokenHash, createdAt: now.toISOString(), ttl },
        // Two concurrent "new link" clicks: only one replaces the pointer it read.
        ConditionExpression: old ? 'tokenHash = :old' : 'attribute_not_exists(PK)',
        ...(old && { ExpressionAttributeValues: { ':old': old } }),
      },
    },
    ...(old ? [{ Delete: { TableName: db.table, Key: keys.invite(old) } }] : []),
  ];
  try {
    await db.doc.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (reasonCodes(e).includes('ConditionalCheckFailed')) {
      throw new AppError('INVALID_TRANSITION', 'The link just changed — try again');
    }
    throw e;
  }
  return { token, expiresAt: rec.end };
}

export async function revokeInvite(db: Db, resId: string) {
  const old = await getInviteLink(db, resId);
  if (!old) return;
  await db.doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: db.table,
            Key: keys.inviteLink(resId),
            ConditionExpression: 'tokenHash = :h',
            ExpressionAttributeValues: { ':h': old },
          },
        },
        { Delete: { TableName: db.table, Key: keys.invite(old) } },
      ],
    }),
  );
}

/**
 * Token → reservation, or null for unknown / revoked / expired (all look the same to callers).
 * The lookup is by hash (no secret comparison in a loop); the stored hash is re-checked in
 * constant time.
 */
export async function resolveInvite(db: Db, token: string, now: Date) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const tokenHash = hashInviteToken(token);
  const r = await db.doc.send(
    new GetCommand({ TableName: db.table, Key: keys.invite(tokenHash), ConsistentRead: true }),
  );
  const item = r.Item;
  if (!item) return null;
  const stored = Buffer.from(String(item.PK).slice('INVITE#'.length), 'hex');
  const want = Buffer.from(tokenHash, 'hex');
  if (stored.length !== want.length || !timingSafeEqual(stored, want)) return null;
  if ((item.ttl as number) * 1000 <= now.getTime()) return null; // expired, TTL not yet swept
  const rec = await getReservation(db, item.resId as string);
  return rec ? { rec, tokenHash } : null;
}

export interface AttendeeRecord {
  userId: string;
  alias: string;
  joinedAt: string;
}

export async function listAttendees(db: Db, resId: string): Promise<AttendeeRecord[]> {
  const items = await queryAll(db, {
    KeyConditionExpression: 'PK = :p AND begins_with(SK, :a)',
    ExpressionAttributeValues: { ':p': keys.resPk(resId), ':a': keys.prefix.attendee },
  });
  return items
    .map((i) => ({
      userId: i.userId as string,
      alias: i.alias as string,
      joinedAt: i.joinedAt as string,
    }))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

export const attendeeIds = async (db: Db, resId: string) =>
  (await listAttendees(db, resId)).map((a) => a.userId);

export type JoinOutcome = 'joined' | 'already';

/** Idempotent join. Owner + attendees ≤ capacity; reservation still active and not ended. */
export async function joinReservation(
  db: Db,
  rec: ReservationRecord,
  user: { userId: string; displayAlias: string },
  capacity: number,
  now: Date,
): Promise<JoinOutcome> {
  if (user.userId === rec.ownerId) {
    throw new AppError('OWN_RESERVATION', 'You’re hosting this one');
  }
  const nowIso = now.toISOString();
  try {
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: db.table,
              Key: keys.reservation(rec.id),
              UpdateExpression: 'ADD attendeeCount :one',
              ConditionExpression:
                '#s IN (:p, :c) AND #e > :now AND ownerId <> :me AND (attribute_not_exists(attendeeCount) OR attendeeCount < :max)',
              ExpressionAttributeNames: { '#s': 'status', '#e': 'end' },
              ExpressionAttributeValues: {
                ':one': 1,
                ':p': ACTIVE[0],
                ':c': ACTIVE[1],
                ':now': nowIso,
                ':me': user.userId,
                ':max': capacity - 1, // the owner takes one seat
              },
            },
          },
          {
            Put: {
              TableName: db.table,
              Item: {
                ...keys.attendee(rec.id, user.userId),
                userId: user.userId,
                alias: user.displayAlias,
                joinedAt: nowIso,
                reservationId: rec.id,
                GSI2PK: keys.gsi2.userPk(user.userId),
                GSI2SK: keys.gsi2.attendSk(rec.start),
                ttl: epoch(rec.end) + 30 * 86_400,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          eventPut(
            db,
            rec.id,
            0,
            {
              type: 'ATTENDEE_JOINED',
              at: nowIso,
              actorId: user.userId,
              data: { alias: user.displayAlias },
              notify: [rec.ownerId],
            },
            now,
          ),
        ],
      }),
    );
    return 'joined';
  } catch (e) {
    const codes = reasonCodes(e);
    if (codes[1] === 'ConditionalCheckFailed') return 'already';
    if (codes[0] === 'ConditionalCheckFailed') {
      const fresh = await getReservation(db, rec.id);
      if (!fresh || !ACTIVE.includes(fresh.status) || fresh.end <= nowIso) {
        throw new AppError('INVALID_TRANSITION', 'This session is no longer happening');
      }
      throw new AppError('ROOM_FULL', 'This room is full');
    }
    throw e;
  }
}

/** Idempotent leave. */
export async function leaveReservation(
  db: Db,
  rec: ReservationRecord,
  userId: string,
  alias: string,
  now: Date,
) {
  try {
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: db.table,
              Key: keys.attendee(rec.id, userId),
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
          {
            Update: {
              TableName: db.table,
              Key: keys.reservation(rec.id),
              UpdateExpression: 'ADD attendeeCount :minus',
              ConditionExpression: 'attendeeCount > :zero',
              ExpressionAttributeValues: { ':minus': -1, ':zero': 0 },
            },
          },
          eventPut(
            db,
            rec.id,
            0,
            {
              type: 'ATTENDEE_LEFT',
              at: now.toISOString(),
              actorId: userId,
              data: { alias },
              notify: [rec.ownerId],
            },
            now,
          ),
        ],
      }),
    );
  } catch (e) {
    if (reasonCodes(e)[0] === 'ConditionalCheckFailed') return; // not an attendee: nothing to do
    throw e;
  }
}

/** Upcoming bookings the user joined (GSI2 ATT# items) → reservation records. */
export async function listJoined(db: Db, userId: string, now: Date) {
  const pivot = keys.gsi2.attendSk(new Date(now.getTime() - 4 * 3_600_000).toISOString());
  const items = await queryAll(db, {
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :p AND GSI2SK BETWEEN :s AND :z',
    ExpressionAttributeValues: {
      ':p': keys.gsi2.userPk(userId),
      ':s': pivot,
      ':z': `${keys.gsi2.attendPrefix}￿`,
    },
  });
  const recs = await Promise.all(items.map((i) => getReservation(db, i.reservationId as string)));
  const nowIso = now.toISOString();
  return recs.filter((r): r is ReservationRecord => !!r && r.end > nowIso);
}
