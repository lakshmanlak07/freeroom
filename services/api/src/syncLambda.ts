/** EventBridge Scheduler target: full 25Live sync (PRD §8.1). */
import { makeDb } from './data/db';
import { createLogger } from './logger';
import { loadInjected, syncSchedule } from './sync/syncSchedule';
import { createScheduleSource } from './twentyfive/source';

const db = makeDb({ table: process.env.TABLE_NAME! });
const log = createLogger({ service: 'sync' });

export const handler = async () => {
  const source = await createScheduleSource({
    secretArn: process.env.TWENTYFIVE_LIVE_SECRET_ARN,
    loadInjected: () => loadInjected(db),
  });
  return syncSchedule({ db, source, now: new Date(), log });
};
