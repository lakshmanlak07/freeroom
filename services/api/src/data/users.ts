import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Role } from '@freeroom/shared';
import { batchGet, type Db, type Item } from './db';
import { keys } from './keys';

/** Public-safe profile. Contact/uidHash are never projected here (BR-5). */
export interface UserProfile {
  userId: string;
  role: Role;
  displayAlias: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

const PROJECTION = 'userId, #r, displayAlias, #s';
const NAMES = { '#r': 'role', '#s': 'status' };

const toProfile = (i: Item): UserProfile => ({
  userId: i.userId as string,
  role: i.role as Role,
  displayAlias: i.displayAlias as string,
  status: (i.status as UserProfile['status']) ?? 'ACTIVE',
});

export async function getUser(db: Db, userId: string): Promise<UserProfile | null> {
  const r = await db.doc.send(
    new GetCommand({
      TableName: db.table,
      Key: keys.user(userId),
      ProjectionExpression: PROJECTION,
      ExpressionAttributeNames: NAMES,
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

export const DEMO_USERS: readonly UserProfile[] = [
  { userId: 'student1', role: 'STUDENT', displayAlias: 'Night Owl', status: 'ACTIVE' },
  { userId: 'student2', role: 'STUDENT', displayAlias: 'Early Bird', status: 'ACTIVE' },
  { userId: 'faculty1', role: 'FACULTY', displayAlias: 'Prof. Maple', status: 'ACTIVE' },
  { userId: 'tutor1', role: 'TUTOR', displayAlias: 'Tutor Pine', status: 'ACTIVE' },
  { userId: 'admin1', role: 'ADMIN', displayAlias: 'FreeRoom Admin', status: 'ACTIVE' },
];
