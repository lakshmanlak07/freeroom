import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AlternativeRoom, Notification } from '@freeroom/shared';
import { AppError } from '../errors';
import { queryAll, ttlFrom, type Db, type Item } from './db';
import { keys } from './keys';

export interface NotificationDraft {
  userId: string;
  /** `${eventAt}#${eventId}` — deterministic, so redelivered stream records are no-ops. */
  notifId: string;
  type: string;
  reservationId: string | null;
  title: string;
  body: string;
  createdAt: string;
  alternatives?: AlternativeRoom[];
}

/** Idempotent per event id: returns false if this notification already exists. */
export async function putNotification(db: Db, n: NotificationDraft): Promise<boolean> {
  try {
    await db.doc.send(
      new PutCommand({
        TableName: db.table,
        Item: {
          ...keys.notification(n.userId, n.notifId),
          ...n,
          read: false,
          ttl: ttlFrom(new Date(n.createdAt), 30),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) return false;
    throw e;
  }
}

const toNotification = (i: Item): Notification => ({
  id: i.notifId as string,
  type: i.type as string,
  reservationId: (i.reservationId as string | null) ?? null,
  title: i.title as string,
  body: i.body as string,
  read: i.read as boolean,
  createdAt: i.createdAt as string,
  ...(i.alternatives ? { alternatives: i.alternatives as AlternativeRoom[] } : {}),
});

const PAGE = 20;

/** Newest first. The cursor is bound to the caller's own partition (no cross-user paging). */
export async function listNotifications(db: Db, userId: string, cursor?: string) {
  let start: Item | undefined;
  if (cursor) {
    try {
      start = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Item;
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Bad cursor');
    }
    if (start.PK !== keys.userPk(userId) || !String(start.SK).startsWith(keys.prefix.notif)) {
      throw new AppError('VALIDATION_ERROR', 'Bad cursor');
    }
    start = { PK: start.PK, SK: start.SK };
  }
  const r = await db.doc.send(
    new QueryCommand({
      TableName: db.table,
      KeyConditionExpression: 'PK = :p AND begins_with(SK, :n)',
      ExpressionAttributeValues: { ':p': keys.userPk(userId), ':n': keys.prefix.notif },
      ScanIndexForward: false,
      Limit: PAGE,
      ExclusiveStartKey: start,
    }),
  );
  const last = r.LastEvaluatedKey as Item | undefined;
  return {
    notifications: (r.Items ?? []).map(toNotification),
    nextCursor: last
      ? Buffer.from(JSON.stringify({ PK: last.PK, SK: last.SK })).toString('base64url')
      : null,
  };
}

export async function markRead(db: Db, userId: string, ids: readonly string[] | 'all') {
  const targets =
    ids === 'all'
      ? (
          await queryAll(db, {
            KeyConditionExpression: 'PK = :p AND begins_with(SK, :n)',
            FilterExpression: '#r = :f',
            ExpressionAttributeNames: { '#r': 'read' },
            ExpressionAttributeValues: {
              ':p': keys.userPk(userId),
              ':n': keys.prefix.notif,
              ':f': false,
            },
          })
        )
          .slice(0, 500)
          .map((i) => i.notifId as string)
      : ids;
  for (const id of targets) {
    try {
      await db.doc.send(
        new UpdateCommand({
          TableName: db.table,
          Key: keys.notification(userId, id),
          UpdateExpression: 'SET #r = :t',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#r': 'read' },
          ExpressionAttributeValues: { ':t': true },
        }),
      );
    } catch (e) {
      if (!(e instanceof ConditionalCheckFailedException)) throw e; // unknown id: ignore
    }
  }
  return targets.length;
}
