/**
 * `pnpm dev:api` = DynamoDB Local + table + seed users + mock 25Live sync + API on :3001,
 * plus the sweeper (every 60s) and the stream → onChange notifier running in-process.
 */
import { serve } from '@hono/node-server';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app';
import { ContactService, LocalKeyProvider } from '../src/contact';
import { makeDb } from '../src/data/db';
import { createTableIfMissing } from '../src/data/table';
import { DEMO_USERS, seedDemoUsers } from '../src/data/users';
import { LOCAL_DEMO_IDS, seedDemoOnce } from '../src/demoSeed';
import { createLogger } from '../src/logger';
import { onChange } from '../src/notify/onChange';
import { createStreamPoller } from '../src/notify/streamPoller';
import { sweep } from '../src/sweeper';
import { loadInjected, syncSchedule } from '../src/sync/syncSchedule';
import { MockSource } from '../src/twentyfive/mock';
import { ensureDynamoLocal } from './ddbLocal';

process.env.NODE_ENV ??= 'development'; // local-only entry point
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const port = Number(process.env.PORT ?? 3001);
const log = createLogger({ service: 'dev' });

const stop = await ensureDynamoLocal(endpoint);
const db = makeDb({ table: process.env.TABLE_NAME ?? 'FreeRoomTable', endpoint });
await createTableIfMissing(db.raw, db.table);

// Dev-only stand-ins for KMS and the Secrets Manager pepper (stable across restarts).
const contacts = new ContactService(
  new LocalKeyProvider(createHash('sha256').update('freeroom-dev-only-kms').digest()),
);
await seedDemoUsers(db, contacts);
const source = new MockSource({ loadInjected: () => loadInjected(db) });
log.info('seed.sync.start');
await syncSchedule({ db, source, now: new Date(), log });
log.info('seed.demo', { result: await seedDemoOnce(db, LOCAL_DEMO_IDS, new Date()) });

const poller = createStreamPoller(db, endpoint, (records) => onChange({ db, log }, records), {
  start: 'LATEST',
  onError: (e) => log.error('stream.poll_failed', { error: e }),
});
poller.start(1000);
const sweeper = setInterval(
  () =>
    sweep(db, new Date()).then(
      (r) => (r.released || r.expired) && log.info('sweep', r),
      (e) => log.error('sweep.failed', { error: e }),
    ),
  60_000,
);
process.on('SIGINT', () => {
  poller.stop();
  clearInterval(sweeper);
  stop();
  process.exit(0);
});

const app = createApp({
  db,
  source,
  logger: log,
  contacts,
  uidPepper: async () => 'dev-only-uid-pepper',
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
