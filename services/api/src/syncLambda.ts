/** EventBridge Scheduler target: full 25Live sync (PRD §8.1). SyncSuccess = 1/0 per run. */
import { currentCorrelationId, withCorrelationId } from './correlation';
import { makeDb } from './data/db';
import { createLogger } from './logger';
import { metric } from './metrics';
import { loadInjected, syncSchedule } from './sync/syncSchedule';
import { createScheduleSource } from './twentyfive/source';

const db = makeDb({ table: process.env.TABLE_NAME! });
const base = createLogger({ service: 'sync' });

export const handler = () =>
  withCorrelationId(undefined, async () => {
    try {
      const source = await createScheduleSource({
        secretArn: process.env.TWENTYFIVE_LIVE_SECRET_ARN,
        loadInjected: () => loadInjected(db),
      });
      const log = base.child({ correlationId: currentCorrelationId() });
      const summary = await syncSchedule({ db, source, now: new Date(), log });
      metric('SyncSuccess', summary.status === 'SUCCESS' ? 1 : 0);
      return summary;
    } catch (e) {
      metric('SyncSuccess', 0);
      throw e;
    }
  });
