/**
 * Demo reset: wipe reservations/claims/notifications/injected classes, resync the schedule,
 * re-seed the demo, and record when it happened. Used by POST /demo/reset (admin) and the dev-only
 * scheduled DemoResetFn (every 2 h, so one judge can't leave the next an empty demo).
 */
import { BatchWriteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Db, Item } from './data/db';
import { keys } from './data/keys';
import { getDemoIds, seedDemo } from './demoSeed';
import type { Logger } from './logger';
import { syncSchedule } from './sync/syncSchedule';
import type { ScheduleSource } from './twentyfive/source';

export interface ResetDeps {
  db: Db;
  source: ScheduleSource;
  now: Date;
  log: Logger;
}
export type ResetBy = 'admin' | 'schedule';

export async function resetDemo(deps: ResetDeps, by: ResetBy) {
  const { db, now } = deps;
  const doomed: Item[] = [];
  let start: Item | undefined;
  do {
    const page = await db.doc.send(
      new ScanCommand({
        TableName: db.table,
        ExclusiveStartKey: start,
        ProjectionExpression: 'PK, SK, kind',
      }),
    );
    for (const i of page.Items ?? []) {
      const pk = String(i.PK);
      const sk = String(i.SK);
      if (
        pk.startsWith(keys.prefix.res) ||
        pk.startsWith(keys.prefix.idemp) ||
        pk === keys.injectedPk ||
        sk === keys.quota('x').SK ||
        sk === keys.claimQuota('x').SK ||
        sk.startsWith(keys.prefix.notif) ||
        (sk === keys.lock('x', 'x').SK && i.kind === 'reservation')
      ) {
        doomed.push({ PK: i.PK, SK: i.SK });
      }
    }
    start = page.LastEvaluatedKey as Item | undefined;
  } while (start);
  for (let i = 0; i < doomed.length; i += 25) {
    await db.doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [db.table]: doomed.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
        },
      }),
    );
  }
  const sync = await syncSchedule({ db, source: deps.source, now, log: deps.log });
  const seeded = await seedDemo(db, await getDemoIds(db), now);
  await db.doc.send(
    new PutCommand({
      TableName: db.table,
      Item: { ...keys.demoLastReset, at: now.toISOString(), by, deleted: doomed.length },
    }),
  );
  return { deleted: doomed.length, sync, seeded };
}

export async function lastDemoReset(db: Db): Promise<{ at: string; by: ResetBy } | null> {
  const r = await db.doc.send(new GetCommand({ TableName: db.table, Key: keys.demoLastReset }));
  return r.Item ? { at: r.Item.at as string, by: r.Item.by as ResetBy } : null;
}
