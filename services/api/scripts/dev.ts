/** `pnpm dev:api` = DynamoDB Local + table + seed users + mock 25Live sync + API on :3001. */
import { serve } from '@hono/node-server';
import { createApp } from '../src/app';
import { makeDb } from '../src/data/db';
import { createTableIfMissing } from '../src/data/table';
import { DEMO_USERS, putUser } from '../src/data/users';
import { createLogger } from '../src/logger';
import { loadInjected, syncSchedule } from '../src/sync/syncSchedule';
import { MockSource } from '../src/twentyfive/mock';
import { ensureDynamoLocal } from './ddbLocal';

process.env.NODE_ENV ??= 'development'; // local-only entry point
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const port = Number(process.env.PORT ?? 3001);
const log = createLogger({ service: 'dev' });

const stop = await ensureDynamoLocal(endpoint);
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});

const db = makeDb({ table: process.env.TABLE_NAME ?? 'FreeRoomTable', endpoint });
await createTableIfMissing(db.raw, db.table);
await Promise.all(DEMO_USERS.map((u) => putUser(db, u)));
const source = new MockSource({ loadInjected: () => loadInjected(db) });
log.info('seed.sync.start');
await syncSchedule({ db, source, now: new Date(), log });

const app = createApp({
  db,
  source,
  logger: log,
  devAuth: process.env.NODE_ENV === 'development',
  mock25live: true,
  demo: true,
});
serve({ fetch: app.fetch, port }, () =>
  log.info('api.ready', {
    url: `http://localhost:${port}`,
    devUsers: DEMO_USERS.map((u) => u.userId),
  }),
);
