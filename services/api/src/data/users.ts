import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Role, ShareChannel } from '@freeroom/shared';
import type { ContactService, EncryptedContact } from '../contact';
import { batchGet, type Db, type Item } from './db';
import { keys } from './keys';

/** Public-safe profile. Contact and uidHash are never part of it (BR-5). */
export interface UserProfile {
  userId: string;
  role: Role;
  displayAlias: string;
  status: 'ACTIVE' | 'SUSPENDED';
  shareChannel?: ShareChannel;
}

const PROJECTION = 'userId, #r, displayAlias, #s, shareChannel';
const NAMES = { '#r': 'role', '#s': 'status' };

const toProfile = (i: Item): UserProfile => ({
  userId: i.userId as string,
  role: i.role as Role,
  displayAlias: i.displayAlias as string,
  status: (i.status as UserProfile['status']) ?? 'ACTIVE',
  ...(i.shareChannel ? { shareChannel: i.shareChannel as ShareChannel } : {}),
});

export async function getUser(db: Db, userId: string): Promise<UserProfile | null> {
  const r = await db.doc.send(
    new GetCommand({
      TableName: db.table,
      Key: keys.user(userId),
      ProjectionExpression: PROJECTION,
      ExpressionAttributeNames: NAMES,
      ConsistentRead: true,
    }),
  );
  return r.Item ? toProfile(r.Item) : null;
}

export async function getUsers(db: Db, ids: readonly string[]): Promise<Map<string, UserProfile>> {
  const items = await batchGet(db, [...new Set(ids)].map(keys.user));
  return new Map(items.map((i) => [i.userId as string, toProfile(i)]));
}

/** Seed/admin use only. Role is never client-chosen (see RegisterRequestSchema). */
export async function putUser(db: Db, u: UserProfile) {
  await db.doc.send(
    new PutCommand({ TableName: db.table, Item: { ...keys.user(u.userId), ...u } }),
  );
}

export async function setRole(db: Db, userId: string, role: Role) {
  await db.doc.send(
    new UpdateCommand({
      TableName: db.table,
      Key: keys.user(userId),
      UpdateExpression: 'SET #r = :r',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#r': 'role' },
      ExpressionAttributeValues: { ':r': role },
    }),
  );
}

export async function getPrivate(db: Db, userId: string): Promise<EncryptedContact | null> {
  const r = await db.doc.send(
    new GetCommand({ TableName: db.table, Key: keys.userPrivate(userId) }),
  );
  return (r.Item?.contactEnc as EncryptedContact | undefined) ?? null;
}

export async function putPrivate(db: Db, userId: string, contactEnc: EncryptedContact) {
  await db.doc.send(
    new PutCommand({ TableName: db.table, Item: { ...keys.userPrivate(userId), contactEnc } }),
  );
}

/**
 * ONE transaction: UID#{hmac} uniqueness + profile (role always STUDENT) + encrypted contact.
 * The raw University ID never reaches this layer.
 */
export async function registerUser(
  db: Db,
  u: {
    userId: string;
    displayAlias: string;
    shareChannel: ShareChannel;
    uidHash: string;
    contactEnc: EncryptedContact;
    now: Date;
  },
): Promise<'ok' | 'uid_taken' | 'already_registered'> {
  try {
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: db.table,
              Item: { ...keys.uid(u.uidHash), userId: u.userId },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: db.table,
              Item: {
                ...keys.user(u.userId),
                userId: u.userId,
                role: 'STUDENT',
                displayAlias: u.displayAlias,
                shareChannel: u.shareChannel,
                status: 'ACTIVE',
                uidHash: u.uidHash,
                createdAt: u.now.toISOString(),
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: db.table,
              Item: { ...keys.userPrivate(u.userId), contactEnc: u.contactEnc },
            },
          },
        ],
      }),
    );
    return 'ok';
  } catch (e) {
    if (!(e instanceof TransactionCanceledException)) throw e;
    const codes = (e.CancellationReasons ?? []).map((r) => r.Code);
    if (codes[1] === 'ConditionalCheckFailed') return 'already_registered';
    if (codes[0] === 'ConditionalCheckFailed') return 'uid_taken';
    throw e;
  }
}

export async function updateProfile(
  db: Db,
  userId: string,
  patch: { displayAlias?: string; shareChannel?: ShareChannel },
) {
  const sets = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!sets.length) return;
  await db.doc.send(
    new UpdateCommand({
      TableName: db.table,
      Key: keys.user(userId),
      UpdateExpression: `SET ${sets.map(([k]) => `#${k} = :${k}`).join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: Object.fromEntries(sets.map(([k]) => [`#${k}`, k])),
      ExpressionAttributeValues: Object.fromEntries(sets.map(([k, v]) => [`:${k}`, v])),
    }),
  );
}

export const DEMO_USERS: readonly UserProfile[] = [
  {
    userId: 'student1',
    role: 'STUDENT',
    displayAlias: 'Night Owl',
    status: 'ACTIVE',
    shareChannel: 'email',
  },
  {
    userId: 'student2',
    role: 'STUDENT',
    displayAlias: 'Early Bird',
    status: 'ACTIVE',
    shareChannel: 'email',
  },
  {
    userId: 'faculty1',
    role: 'FACULTY',
    displayAlias: 'Prof. Maple',
    status: 'ACTIVE',
    shareChannel: 'email',
  },
  {
    userId: 'tutor1',
    role: 'TUTOR',
    displayAlias: 'Tutor Pine',
    status: 'ACTIVE',
    shareChannel: 'phone',
  },
  {
    userId: 'admin1',
    role: 'ADMIN',
    displayAlias: 'FreeRoom Admin',
    status: 'ACTIVE',
    shareChannel: 'email',
  },
];

/** Seed demo users with fake, encrypted contact (reserved .test TLD — never deliverable). */
export async function seedDemoUsers(db: Db, contacts: ContactService) {
  await Promise.all(
    DEMO_USERS.map(async (u) => {
      await putUser(db, u);
      await putPrivate(
        db,
        u.userId,
        await contacts.encrypt(u.userId, {
          email: `${u.userId}@demo.freeroom.test`,
          phone: '+1 413 555 0100',
        }),
      );
    }),
  );
}

/**
 * Per-user, per-minute natural-language search budget: one atomic ADD on a TTL'd counter, so the
 * limit holds across Lambda instances. Returns false once the minute's budget is spent.
 */
export async function takeNlSearchToken(db: Db, userId: string, now: Date, perMinute: number) {
  const minute = now.toISOString().slice(0, 16); // yyyy-mm-ddThh:mm (UTC)
  const r = await db.doc.send(
    new UpdateCommand({
      TableName: db.table,
      Key: keys.nlRate(userId, minute),
      UpdateExpression: 'ADD #n :one SET #ttl = :ttl',
      ExpressionAttributeNames: { '#n': 'n', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': Math.floor(now.getTime() / 1000) + 120 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return (r.Attributes?.n as number) <= perMinute;
}
