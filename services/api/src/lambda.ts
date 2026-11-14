import { handle } from 'hono/aws-lambda';
import { createApp } from './app';
import { makeDb } from './data/db';
import { loadInjected } from './sync/syncSchedule';
import { createScheduleSource } from './twentyfive/source';

const db = makeDb({ table: process.env.TABLE_NAME! });
const source = await createScheduleSource({
  secretArn: process.env.TWENTYFIVE_LIVE_SECRET_ARN,
  loadInjected: () => loadInjected(db),
});
const demo = process.env.ENABLE_DEMO === 'true';

export const handler = handle(
  createApp({
    db,
    source,
    devAuth: process.env.NODE_ENV === 'development',
    mock25live: demo,
    demo,
  }),
);
