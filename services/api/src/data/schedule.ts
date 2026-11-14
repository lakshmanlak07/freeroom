/** Cached 25Live classes, class slot locks, per room/day sync metadata. Written by sync only. */
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ClassEvent } from '@freeroom/domain';
import { batchGet, queryAll, ttlFrom, type Db } from './db';
import { keys } from './keys';

export interface StoredClass extends ClassEvent {
  sourceHash: string;
}

export async function getRoomDay(
  db: Db,
  roomId: string,
  day: string,
): Promise<{ classes: StoredClass[]; lastSyncedAt: string | null }> {
  const items = await queryAll(db, {
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': keys.roomDayPk(roomId, day) },
    ConsistentRead: true,
  });
  let lastSyncedAt: string | null = null;
  const classes: StoredClass[] = [];
  for (const i of items) {
    if (i.SK === keys.syncMeta(roomId, day).SK) lastSyncedAt = i.lastSyncedAt as string;
    else if (String(i.SK).startsWith(keys.prefix.class)) {
      classes.push({
        eventId: i.eventId as string,
        roomId: i.roomId as string,
        name: i.name as string,
        ...(i.courseCode ? { courseCode: i.courseCode as string } : {}),
        ...(i.section ? { section: i.section as string } : {}),
        ...(i.eventType ? { eventType: i.eventType as string } : {}),
        ...(i.organization ? { organization: i.organization as string } : {}),
        start: new Date(i.start as string),
        end: new Date(i.end as string),
        sourceHash: i.sourceHash as string,
      });
    }
  }
  return { classes, lastSyncedAt };
}

export async function putClass(db: Db, day: string, c: StoredClass, syncRunId: string) {
  const { start, end, ...rest } = c;
  await db.doc.send(
    new PutCommand({
      TableName: db.table,
      Item: {
        ...keys.classItem(c.roomId, day, start.toISOString(), c.eventId),
        ...rest,
        start: start.toISOString(),
        end: end.toISOString(),
        syncRunId,
        ttl: ttlFrom(end, 7),
      },
    }),
  );
}

export async function deleteClass(db: Db, day: string, c: ClassEvent) {
  await db.doc.send(
    new DeleteCommand({
      TableName: db.table,
      Key: keys.classItem(c.roomId, day, c.start.toISOString(), c.eventId),
    }),
  );
}

export async function setSyncMeta(db: Db, roomId: string, day: string, atIso: string) {
  await db.doc.send(
    new PutCommand({
      TableName: db.table,
      Item: { ...keys.syncMeta(roomId, day), lastSyncedAt: atIso },
    }),
  );
}

/**
 * Write class slot locks (kind=class, eventIds set — back-to-back classes may share a slot).
 * Returns ids of reservations already holding any of these slots (→ BR-9).
 */
export async function lockClassSlots(db: Db, roomId: string, slots: Date[], eventId: string) {
  const conflicts = new Set<string>();
  for (const slot of slots) {
    const key = keys.lock(roomId, slot.toISOString());
    try {
      await db.doc.send(
        new UpdateCommand({
          TableName: db.table,
          Key: key,
          UpdateExpression:
            'SET kind = :class, roomId = :r, slot = :s, #ttl = :ttl ADD eventIds :e',
          ConditionExpression: 'attribute_not_exists(PK) OR kind = :class',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':class': 'class',
            ':r': roomId,
            ':s': slot.toISOString(),
            ':e': new Set([eventId]),
            ':ttl': ttlFrom(slot, 7),
          },
        }),
      );
    } catch (e) {
      if (!(e instanceof ConditionalCheckFailedException)) throw e;
      const held = await db.doc.send(
        new GetCommand({ TableName: db.table, Key: key, ConsistentRead: true }),
      );
      if (held.Item?.resId) conflicts.add(held.Item.resId as string);
    }
  }
  return [...conflicts];
}

export async function unlockClassSlots(db: Db, roomId: string, slots: Date[], eventId: string) {
  for (const slot of slots) {
    const Key = keys.lock(roomId, slot.toISOString());
    try {
      const r = await db.doc.send(
        new UpdateCommand({
          TableName: db.table,
          Key,
          UpdateExpression: 'DELETE eventIds :e',
          ConditionExpression: 'kind = :class',
          ExpressionAttributeValues: { ':e': new Set([eventId]), ':class': 'class' },
          ReturnValues: 'ALL_NEW',
        }),
      );
      if (!(r.Attributes?.eventIds as Set<string> | undefined)?.size) {
        await db.doc.send(
          new DeleteCommand({
            TableName: db.table,
            Key,
            ConditionExpression: 'attribute_not_exists(eventIds)',
          }),
        );
      }
    } catch (e) {
      if (!(e instanceof ConditionalCheckFailedException)) throw e; // already gone or re-locked
    }
  }
}

/** Lock items (any kind) for the given room slots, keyed `${roomId}|${slotIso}`. */
export async function getLocks(db: Db, wanted: { roomId: string; slotIso: string }[]) {
  const items = await batchGet(
    db,
    wanted.map((w) => keys.lock(w.roomId, w.slotIso)),
  );
  return new Map(items.map((i) => [`${i.roomId as string}|${i.slot as string}`, i]));
}
